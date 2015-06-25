/**
* Generalized session state and auth manager for Orator/restify
*
* @class OratorSession
* @constructor
*/
var OratorSession = function()
{
	function createNew(pFable)
	{
		// If a valid fable object isn't passed in, return a constructor
		if ((typeof(pFable) !== 'object') || (!pFable.hasOwnProperty('fable')))
			return {new: createNew};

		var _Settings = pFable.settings;
		var _Log = pFable.log;

		var libCookieParser = require('restify-cookies');
		var libUUIDGenerator = require('fable-uuid').new(pFable.settings);

		var libMemcached = require('memcached');
		var _Memcached = false;
		_Log.trace('Connecting to Memcached '+_Settings.Session.MemcachedURL);
		_Memcached = new libMemcached(_Settings.Session.MemcachedURL);

		/**
		* Wire up routes for the OratorSession
		*
		* @method connectRoutes
		* @param {Object} pRestServer The Restify server object to add routes to
		*/
		var connectRoutes = function(pRestServer)
		{
			pRestServer.use(libCookieParser.parse);
			// This means the getSession is called on every request
			pRestServer.use(getSession);

			//We could add routes here to support different auth-types
			// depending on configuration (WWW-Auth for example)
		};

		/**
		 * Get a Session (creating one if it doesn't exist)
		 *
		 * @method getSession
		 */
		var getSession = function getSession(pRequest, pResponse, fNext)
		{
			if ((typeof(pRequest.cookies.UserSession) === 'undefined') || (pRequest.cookies.UserSession === ''))
			{
				createSession(pRequest, pResponse, fNext);
			}
			else
			{
				//_Log.trace('Cookie reports session '+pRequest.cookies.UserSession);
				_Memcached.get(pRequest.cookies.UserSession,
					function(pError, pData)
					{
						if (pError)
						{
							_Log.trace('Session ID not found but cookie exists, creating a new session'+pError, {SessionID:pRequest.cookies.UserSession});
							createSession(pRequest, pResponse, fNext);
						}
						else
						{
							if (typeof(pData) === 'undefined')
							{
								createSession(pRequest, pResponse, fNext);
							}
							else
							{
								//_Log.trace('Restoring session', {SessionID:pRequest.cookies.UserSession});
								// Touch the session so we reset timeout.
								_Memcached.touch(pRequest.cookies.UserSession, _Settings.Session.Timeout, function (pError) { /* TODO: Log errors on the touch. */ });
								pRequest.UserSession = JSON.parse(pData)
								fNext();
							}
						}
					}
				);
			}
		};

		/**
		 * Create a session in memcache
		 *
		 * @method createSession
		 */
		 var createSession = function(pRequest, pResponse, fNext)
		 {
			// Create a new session UUID...
			var tmpUUID = libUUIDGenerator.getUUID();
			var tmpSessionID = 'SES'+tmpUUID;
			_Log.info('Creating a new session', {SessionID:tmpSessionID});

			// This is the state stored in Memcached
			// We store this much to prevent roundtrips to the database each request
			var tmpNewSessionData = (
				{
					SessionID: tmpSessionID,
					UserID: 0,
					UserRole: 'None',
					UserRoleIndex: 0,
					LoggedIn: false,
					DeviceID: tmpUUID
				});
			var tmpNewSessionDataString = JSON.stringify(tmpNewSessionData);

			_Memcached.get(tmpSessionID,
				function(pError, pData)
				{
					if (pError)
					{
						//_Log.trace('Error checking if session exists in memcache'+pError, {SessionID:tmpSessionID});
						_Memcached.set(tmpSessionID, tmpNewSessionDataString, _Settings.Session.Timeout,
							function(pError)
							{
								if (pError) _Log.trace('Error setting session: '+pError, {SessionID:tmpSessionID});
								pRequest.UserSession = tmpNewSessionData;
								pResponse.setCookie('UserSession',tmpNewSessionData.SessionID, {path: '/', maxAge: _Settings.Session.Timeout, httpOnly: true });
								return fNext();
							}
						);
					}
					else
					{
						if (typeof(pData === undefined))
						{
							//_Log.trace('Session ID not found, creating', {SessionID:tmpSessionID});
							_Memcached.set(tmpSessionID, tmpNewSessionDataString, _Settings.Session.Timeout,
								function(pError)
								{
									if (pError) _Log.trace('Error setting session: '+pError, {SessionID:tmpSessionID});
									pRequest.UserSession = tmpNewSessionData;
									pResponse.setCookie('UserSession',tmpNewSessionData.SessionID, {path: '/', maxAge: _Settings.Session.Timeout, httpOnly: true });
									return fNext();
								}
							);
						}
						else
						{
							//_Log.trace('Session UUID collision.. this should NEVER happen', {SessionID:tmpSessionID, SessionData:pData});
							_Memcached.replace(tmpSessionID, tmpNewSessionDataString, 600,
								function(pError)
								{
									if (pError) _Log.trace('Error replacing session: '+pError, {SessionID:tmpSessionID});
									pRequest.UserSession = tmpNewSessionData;
									pResponse.setCookie('UserSession',tmpNewSessionData.SessionID, {path: '/', maxAge: _Settings.Session.Timeout, httpOnly: true });
									return fNext();
								}
							);
						}
					}
				}
			);
		};

		/**
		 * Set the session login status
		 *
		 * @method setSessionLoginStatus
		 * @param {Object} pRequest The request object to set a status on
		 * @param {Object} pLoginResult An object which contains login result data
		 */
		var setSessionLoginStatus = function(pRequest, pLoginResult)
		{
			pRequest.UserSession.LoggedIn = pLoginResult.LoggedIn;
			pRequest.UserSession.UserRole = pLoginResult.UserRole;
			pRequest.UserSession.UserRoleIndex = pLoginResult.RoleIndex;
			pRequest.UserSession.UserID = pLoginResult.UserID;

			//_Log.trace('Setting session status.', {SessionID:pRequest.UserSession.SessionID, Session: pRequest.UserSession});
			_Memcached.replace(pRequest.UserSession.SessionID, JSON.stringify(pRequest.UserSession), _Settings.Session.Timeout,
				function(pError)
				{
					if (pError)
					{
						_Log.trace('Error setting session status: '+pError, {SessionID:pRequest.UserSession.SessionID, Session: pRequest.UserSession});
					}
				}
			);
		};

		/**
		 * Check the session login status
		 *
		 * @method checkIfLoggedIn
		 * @param {Object} pRequest The request object to check status on
		 */
		 var checkIfLoggedIn = function(pRequest)
		 {
		 	if ((typeof(pRequest.cookies.UserSession) === 'undefined') || (pRequest.cookies.UserSession === ''))
			{
				return false;
			}
			else
			{
				return (pRequest.UserSession.LoggedIn && pRequest.UserSession.UserID > 0);
			}
		 };

		/**
		 * Log a user into the system using authenticator function
		 *
		 * @method authenticateUser
		 * @param {Object} pRequest The request object which contains a Credentials object
		 */
		var authenticateUser = function(pRequest, fAuthenticator, fCallBack)
		{
			_Log.trace('A user is attempting to login: ' + pRequest.Credentials.username);

			fAuthenticator(pRequest.Credentials, function(err, loginResult)
			{
				var tmpStatus = (loginResult.LoggedIn && loginResult.UserID > 0) ?
					'success' :
					'failed';

				_Log.trace('User login ' + tmpStatus);

				//set memcache session to login result
				setSessionLoginStatus(pRequest, loginResult);

				fCallBack(err, loginResult);
			});
		};

		/**
		 * Default: Authenticate where credentials must match config
		 *
		 * @method defaultAuthenticator
		 */
		var defaultAuthenticator = function(pCredentials, fCallBack)
		{
			var tmpAuthResult = (
			{
				LoggedIn: false,
				UserID: 0,
				Role: '',
				RoleIndex: 0
			});

			if (pCredentials.username === _Settings.Session.DefaultUsername &&
				pCredentials.password === _Settings.Session.DefaultPassword)
			{
				tmpAuthResult.LoggedIn = true;
				tmpAuthResult.UserID = 1;
			}

			fCallBack(null, tmpAuthResult);
		};

		var tmpOratorSession = (
		{
			connectRoutes: connectRoutes,
			checkIfLoggedIn: checkIfLoggedIn,
			authenticateUser: authenticateUser,
			defaultAuthenticator: defaultAuthenticator,
			//remoteAuthenticator: remoteAuthenticator,
			new: createNew
		});

		return tmpOratorSession;
	}

	return createNew();
};

module.exports = new OratorSession();

