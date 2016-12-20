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

		//Default settings value for session cookie name
		if (!_Settings.SessionCookieName)
			_Settings.SessionCookieName = 'UserSession';
		if (!_Settings.SessionTempTokenTimeout)
			_Settings.SessionTempTokenTimeout = 60;
		if (!_Settings.SessionStrategy || //TODO: improve this settings fallback
			(_Settings.SessionStrategy !== 'Memcached' &&
			_Settings.SessionStrategy !== 'InMemory'))
			_Settings.SessionStrategy = 'Memcached';

		var libCookieParser = require('restify-cookies');
		var libUUIDGenerator = require('fable-uuid').new(pFable.settings);

		var libSessionStore = require(__dirname + '/strategies/' + _Settings.SessionStrategy).new(pFable);

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
			// This checks for a temp session token on every request
			pRestServer.use(getTempSession); //import session when ?SessionToken=temp_token_id
			// This logs each request after the session is set
			pRestServer.use(logSession);

			// Deauthenticate
			pRestServer.get('1.0/Deauthenticate', deAuthenticateUser);

			pRestServer.get('1.0/CheckSession', checkSession);

			//checkout a temp token which allows 3rd party connection to use this session
			pRestServer.get('1.0/CheckoutSessionToken', getSessionToken);

			//We could add routes here to support different auth-types
			// depending on configuration (WWW-Auth for example)

			//In case of an Orator proxy, these endpoints need to be omitted
			if (pFable.omitProxyRoute)
			{
				pFable.omitProxyRoute('1.0/Deauthenticate');
				pFable.omitProxyRoute('1.0/CheckSession');
				pFable.omitProxyRoute('1.0/CheckoutSessionToken');
			}
		};

		/**
		 * Get SessionID
		 */
		var getSessionID = function(pRequest)
		{
			//SessionID first source from session cookie, then fallback to session state object
			var tmpSessionID = pRequest.cookies[_Settings.SessionCookieName];
			if (!tmpSessionID)
			{
				//this happens when new cookie is set but not received by client
				if (pRequest[_Settings.SessionCookieName])
					tmpSessionID = pRequest[_Settings.SessionCookieName].SessionID;
			}
			return tmpSessionID;
		}

		/**
		 * Get a Session (creating one if it doesn't exist)
		 *
		 * @method getSession
		 */
		var getSession = function getSession(pRequest, pResponse, fNext)
		{
			//TODO: maybe create a registry for this
			if (pRequest.url.indexOf('/ping.html') === 0)
				return fNext();

			if ((typeof(getSessionID(pRequest)) === 'undefined') || (getSessionID(pRequest) === ''))
			{
				return createSession(pRequest, pResponse, fNext);
			}
			else
			{
				//_Log.trace('Cookie reports session '+getSessionID(pRequest));
				libSessionStore.get(getSessionID(pRequest),
					function(pError, pData)
					{
						if (pError)
						{
							_Log.trace('Session ID not found but cookie exists, creating a new session'+pError, {SessionID:getSessionID(pRequest)});
							return createSession(pRequest, pResponse, fNext);
						}
						else
						{
							if (typeof(pData) === 'undefined')
							{
								return createSession(pRequest, pResponse, fNext);
							}
							else
							{
								//_Log.trace('Restoring session', {SessionID:getSessionID(pRequest)});
								// Touch the session so we reset timeout.
								libSessionStore.touch(getSessionID(pRequest), _Settings.SessionTimeout, function (pError) { /* TODO: Log errors on the touch. */ });
								pRequest[_Settings.SessionCookieName] = JSON.parse(pData)
								
								return fNext();
							}
						}
					}
				);
			}
		};

		/**
		 * Get a Temp Session
		 *
		 * @method getTempSession
		 * @params Querystring: ?SessionToken=temp_token_id
		 */
		var getTempSession = function(pRequest, pResponse, fNext)
		{
			if (!pRequest.query.SessionToken)
				return fNext();

			//validate SessionToken
			libSessionStore.get(pRequest.query.SessionToken,
				function(pError, pSessionIdentifierData)
				{
					if (!pSessionIdentifierData)
					{
						_Log.error('Failed to find temp session token '+pRequest.query.SessionToken);
						return fNext();
					}

					//verify that parent session is still active
					libSessionStore.get(pSessionIdentifierData,
						function(pError, pData)
						{
							if (pError)
							{
								_Log.error('Failed to find session ' + pSessionIdentifierData + ' using temp token '+pRequest.query.SessionToken);
								return fNext();
							}

							var tmpSession = JSON.parse(pData);

							if (!tmpSession.LoggedIn)
							{
								_Log.error('User session ' + pSessionIdentifierData + ' is no longer logged in!');
								return fNext();
							}

							_Log.trace('Session import using temp session token',
							{
								SessionID: pRequest[_Settings.SessionCookieName].SessionID,
								ParentSessionID: tmpSession.SessionID,
								TempSessionToken: pRequest.query.SessionToken
							});

							//allow this user session to import attributes from parent session
							tmpSession.SessionID = pRequest[_Settings.SessionCookieName].SessionID;

							setSessionLoginStatus(pRequest, tmpSession);

							return fNext();
						});
				});
		}

		/**
		* Get the currently logged in user
		*/
		var checkSession = function(pRequest, pResponse, fNext)
		{
			var tmpNext = (typeof(fNext) === 'function') ? fNext : function() {};

			if (!pRequest[_Settings.SessionCookieName].LoggedIn)
			{
				pResponse.send({IDUser: 0, UserID:0, LoggedIn: false});
				return tmpNext();
			}

			var tmpIDUser = pRequest[_Settings.SessionCookieName].UserID;
			if (tmpIDUser < 1)
			{
				pResponse.send({IDUser: 0, UserID:0, LoggedIn: false});
				return tmpNext();
			}

			pResponse.send(pRequest[_Settings.SessionCookieName]);
			return tmpNext();
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
			var tmpNewSessionData = formatEmptyUserPacket(tmpSessionID, tmpUUID);

			if (pRequest.SessionOverrideData)
			{
				_Log.info('SessionOverride data is specified.');

				tmpSessionID = pRequest.SessionOverrideData.SessionID;
				tmpNewSessionData = pRequest.SessionOverrideData;
			}

			_Log.info('Creating a new session', {SessionID:tmpSessionID});

			// This is the state stored in Memcached
			// We store this much to prevent roundtrips to the database each request
			var tmpNewSessionDataString = JSON.stringify(tmpNewSessionData);

			libSessionStore.get(tmpSessionID,
				function(pError, pData)
				{
					if (pError)
					{
						//_Log.trace('Error checking if session exists in memcache'+pError, {SessionID:tmpSessionID});
						libSessionStore.set(tmpSessionID, tmpNewSessionDataString, _Settings.SessionTimeout,
							function(pError)
							{
								if (pError) _Log.trace('Error setting session: '+pError, {SessionID:tmpSessionID});
								pRequest[_Settings.SessionCookieName] = tmpNewSessionData;
								pResponse.setCookie(_Settings.SessionCookieName,tmpNewSessionData.SessionID, {path: '/', maxAge: _Settings.SessionTimeout, httpOnly: true });
								return fNext();
							}
						);
					}
					else
					{
						if (typeof(pData === undefined))
						{
							//_Log.trace('Session ID not found, creating', {SessionID:tmpSessionID});
							libSessionStore.set(tmpSessionID, tmpNewSessionDataString, _Settings.SessionTimeout,
								function(pError)
								{
									if (pError) _Log.trace('Error setting session: '+pError, {SessionID:tmpSessionID});
									pRequest[_Settings.SessionCookieName] = tmpNewSessionData;
									pResponse.setCookie(_Settings.SessionCookieName,tmpNewSessionData.SessionID, {path: '/', maxAge: _Settings.SessionTimeout, httpOnly: true });
									return fNext();
								}
							);
						}
						else
						{
							//_Log.trace('Session UUID collision.. this should NEVER happen', {SessionID:tmpSessionID, SessionData:pData});
							libSessionStore.replace(tmpSessionID, tmpNewSessionDataString, 600,
								function(pError)
								{
									if (pError) _Log.trace('Error replacing session: '+pError, {SessionID:tmpSessionID});
									pRequest[_Settings.SessionCookieName] = tmpNewSessionData;
									pResponse.setCookie(_Settings.SessionCookieName,tmpNewSessionData.SessionID, {path: '/', maxAge: _Settings.SessionTimeout, httpOnly: true });
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
		 * @param {Boolean} pStatus The status of being logged in (true or false)
		 * @param {String} pRole The role of the user
		 */
		var setSessionLoginStatus = function(pRequest, pUserPacket)
		{
			if (!pUserPacket.SessionID)
			{
				//set the SessionID using cookie ID
				pUserPacket.SessionID = getSessionID(pRequest);
			}

			pRequest[_Settings.SessionCookieName] = pUserPacket;

			_Log.trace('Setting session status.', {SessionID:pRequest[_Settings.SessionCookieName].SessionID, Session: pRequest[_Settings.SessionCookieName]});
			libSessionStore.replace(pRequest[_Settings.SessionCookieName].SessionID, JSON.stringify(pRequest[_Settings.SessionCookieName]), _Settings.SessionTimeout,
				function(pError)
				{
					if (pError)
					{
						_Log.trace('Error setting session status: '+pError, {SessionID:pRequest[_Settings.SessionCookieName].SessionID, Session: pRequest[_Settings.SessionCookieName]});
					}
				}
			);
		};

		/**
		 * Log session state on Request
		 */
		var logSession = function(pRequest, pResponse, fNext)
		{
			//TODO: maybe create a registry for this
			if (pRequest.url.indexOf('/ping.html') === 0)
				return fNext();

			_Log.info('Request',
				{
					ClientIP:pRequest.connection.remoteAddress,
					RequestUUID:pRequest.RequestUUID,
					RequestURL:pRequest.url,
					SessionID:pRequest[_Settings.SessionCookieName].SessionID,
					CustomerID:pRequest[_Settings.SessionCookieName].CustomerID,
					UserID:pRequest[_Settings.SessionCookieName].UserID,
				});
			// This duplicates the session data for the Meadow endpoints //TODO: change meadow to use _Settings.SessionCookieName
			pRequest.SessionData = pRequest[_Settings.SessionCookieName];
			
			return fNext();
		}

		/**
		 * Check the session login status
		 *
		 * @method checkIfLoggedIn
		 * @param {Object} pRequest The request object to check status on
		 */
		 var checkIfLoggedIn = function(pRequest)
		 {
		 	if ((typeof(getSessionID(pRequest)) === 'undefined') || (getSessionID(pRequest) === ''))
			{
				return false;
			}
			else
			{
				return (pRequest[_Settings.SessionCookieName].LoggedIn && pRequest[_Settings.SessionCookieName].UserID > 0);
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

			// This will fail if the username or password are equal to false.  Not exactly bad....
			if (!pRequest.Credentials ||
				!pRequest.Credentials.username || 
				!pRequest.Credentials.password)
			{
				_Log.info('Authentication failure', {RequestID:pRequest.RequestUUID,Action:'Authenticate Validation',Success:false});
				return fCallBack('Bad username or password!');
			}

			fAuthenticator(pRequest.Credentials, function(err, loginUserPacketResult)
			{
				if (!loginUserPacketResult)
					loginUserPacketResult = formatEmptyUserPacket(getSessionID(pRequest));

				var tmpStatus = (loginUserPacketResult.LoggedIn && loginUserPacketResult.UserID > 0) ?
					'success' :
					'failed';

				_Log.trace('User login ' + tmpStatus);

				//set the SessionID using cookie ID
				loginUserPacketResult.SessionID = getSessionID(pRequest);

				//set memcache session to login result
				setSessionLoginStatus(pRequest, loginUserPacketResult);

				return fCallBack(err, loginUserPacketResult);
			});
		};

		/**
		 * Default: Authenticate where credentials must match config
		 *
		 * @method defaultAuthenticator
		 */
		var defaultAuthenticator = function(pCredentials, fCallBack)
		{
			if (pCredentials.username === _Settings.DefaultUsername &&
				pCredentials.password === _Settings.DefaultPassword)
			{
				return fCallBack(null, formatUserPacket(null, true, 'Administrator', 5, 1));
			}
			else
			{
				return fCallBack('Invalid username or password!');
			}
		};

		/**
		 * Log a user out from the system
		 *
		 * @method deAuthenticateUser
		 */
		var deAuthenticateUser = function(pRequest, pResponse, fNext)
		{
			_Log.info('Deauthentication success', {RequestID:pRequest.RequestUUID,Action:'Deauthenticate',Success:true});
			var tmpUserPacket = formatEmptyUserPacket(pRequest[_Settings.SessionCookieName].SessionID);
			setSessionLoginStatus(pRequest, tmpUserPacket);
			pResponse.send({Success: true})
		};

		/**
		 * Checkout a session token which can be used by 3rd-party connection to use this User session
		 *
		 * @method getSessionToken
		 */
		var getSessionToken = function(pRequest, pResponse, fCallback)
		{
			checkoutSessionToken(pRequest, function(err, token)
			{
				if (err)
				{
					pResponse.send({Error: err});
				}
				else
				{
					pResponse.send({Token: token});
				}

				return fCallback();
			});
		}

		/**
		 * Checkout a session token which can be used by 3rd-party connection to use this User session
		 *
		 * @method checkoutSessionToken
		 */
		var checkoutSessionToken = function(pRequest, fCallback)
		{
			var tmpSession = pRequest[_Settings.SessionCookieName];
			if (!tmpSession.LoggedIn)
			{
				return fCallback('User not logged in!');
			}

			var tmpUUID = 'TempSessionToken-' + libUUIDGenerator.getUUID();

			libSessionStore.set(tmpUUID, tmpSession.SessionID, _Settings.SessionTempTokenTimeout,
				function(pError)
				{
					if (pError)
						_Log.trace('Error checking out a session token!'+pError, {SessionID: tmpSession.SessionID});
					else
						_Log.trace('Checked out a session token: ' + tmpUUID, {IDUser: tmpSession.UserID, SessionID: tmpSession.SessionID});

					return fCallback(pError, tmpUUID);
				});
		}

		/**
		 * Lookup session from session store, but only retrieve related userID key
		 *
		 * @method getSessionUserID
		 */
		var getSessionUserID = function(pSessionID, fCallback)
		{
			libSessionStore.get(pSessionID,
				function(pError, pData)
				{
					var tmpUserID = 0;
					if (pData)
					{
						var tmpSessionData = JSON.parse(pData);
						if (tmpSessionData.UserID)
							tmpUserID = tmpSessionData.UserID;
					}

					return fCallback(pError, tmpUserID);
				});
		}

		//TODO: make this extensible
		var formatUserPacketFromRecord = function(pUserRecord)
		{
			return formatUserPacket(
				null, //set by authenticateUser
				true, //LoggedIn
				pUserRecord.UserRole, //amended property
				pUserRecord.IDRole,
				pUserRecord.IDUser,
				pUserRecord.IDCustomer,
				pUserRecord.Title,
				pUserRecord.NameFirst,
				pUserRecord.NameLast,
				pUserRecord.Email
				);
		}

		//TODO: make this extensible
		var formatEmptyUserPacket = function(pSessionID)
		{
			return formatUserPacket(
				pSessionID, //SessionID
				false, //LoggedIn
				'None', //UserRole
				0, //UserRoleIndex
				0, //UserID
				0, //CustomerID
				'', //Title
				'', //NameFirst
				'', //NameLast
				'' //Email
				);
		}

		//TODO: make this extensible
		var formatUserPacket = function(pSessionID, pStatus, pRole, pRoleIndex, pUserID, pCustomerID, pTitle, pNameFirst, pNameLast, pEmail)
		{
			return (
			{
				Version: process.env.npm_package_version,
				SessionID: pSessionID,
				LoggedIn: pStatus,
				UserRole: pRole,
				UserRoleIndex: pRoleIndex,
				UserID: pUserID,
				CustomerID: pCustomerID,
				Title: pTitle,
				NameFirst: pNameFirst,
				NameLast: pNameLast,
				Email: pEmail
			});
		}

		var tmpOratorSession = (
		{
			connectRoutes: connectRoutes,
			checkIfLoggedIn: checkIfLoggedIn,
			authenticateUser: authenticateUser,
			defaultAuthenticator: defaultAuthenticator,
			//remoteAuthenticator: remoteAuthenticator,
			createSession: createSession,
			checkSession: checkSession,
			deAuthenticateUser: deAuthenticateUser,
			checkoutSessionToken: checkoutSessionToken,
			getSessionUserID: getSessionUserID,
			formatEmptyUserPacket: formatEmptyUserPacket,
			formatUserPacketFromRecord: formatUserPacketFromRecord,
			formatUserPacket: formatUserPacket,
			setSessionLoginStatus: setSessionLoginStatus,
			new: createNew
		});

		return tmpOratorSession;
	}

	return createNew();
};

module.exports = new OratorSession();

