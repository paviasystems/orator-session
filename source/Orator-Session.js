/**
* Generalized session state and auth manager for Orator/restify
*
* @class OratorSession
* @constructor
*/

const libAsync = require('async');
const libMoment = require('moment');
const libUUID = require('uuid');

class OratorSession
{
	constructor(settings, log)
	{
		this._Settings = settings;
		this._Log = log;

		// Default settings value for session cookie name
		if (!this._Settings.SessionCookieName)
		{
			this._Settings.SessionCookieName = 'UserSession';
		}
		if (!this._Settings.SessionTempTokenTimeout)
		{
			this._Settings.SessionTempTokenTimeout = 60; // in minutes
		}
		if (!this._Settings.SessionStrategy || //TODO: improve this settings fallback
			(this._Settings.SessionStrategy !== 'Memcached' &&
			this._Settings.SessionStrategy !== 'InMemory'))
		{
			this._Settings.SessionStrategy = 'Memcached';
		}

		this._SessionStore = new (require(__dirname + '/strategies/' + settings.SessionStrategy))(settings, log);
		this._PassthroughURLs = new Set(['/ping.html', '/version']);
	}

	/**
	 * Get SessionID
	 */
	getSessionID(pRequest)
	{
		//SessionID first from Authorization header, then from session cookie, then fallback to session state object
		let tmpSessionID = null;

		if (pRequest.headers.hasOwnProperty('authorization')
				&& pRequest.headers.authorization.indexOf('Bearer') == 0)
		{
			tmpSessionID = pRequest.headers.authorization.split(" ")[1];
		}
		else
		{
			tmpSessionID = this.getCookie(pRequest, this._Settings.SessionCookieName);
		}

		if (!tmpSessionID)
		{
			// this happens when new cookie is set but not received by client
			if (pRequest[this._Settings.SessionCookieName])
			{
				tmpSessionID = pRequest[this._Settings.SessionCookieName].SessionID;
			}
		}

		return tmpSessionID;
	}

	/**
	 * Get a Session (creating one if it doesn't exist)
	 *
	 * @method getSession
	 */
	getSession(pRequest, fNext)
	{
		if (this._PassthroughURLs.has(pRequest.url))
		{
			return fNext(); //no session check required
		}

		if (!this.getSessionID(pRequest))
		{
			return this.createSession(pRequest, fNext);
		}
		this._SessionStore.get(this.getSessionID(pRequest), (pError, pData) =>
		{
			if (pError)
			{
				this._Log.trace('Session ID not found but cookie exists, creating a new session' + pError, { SessionID: this.getSessionID(pRequest) });
				return this.createSession(pRequest, fNext);
			}

			if (!pData)
			{
				return this.createSession(pRequest, fNext);
			}

			//this._Log.trace('Restoring session', { SessionID: this.getSessionID(pRequest) });
			// Touch the session so we reset timeout.
			this._SessionStore.touch(this.getSessionID(pRequest), this._Settings.SessionTimeout, (pError) =>
			{
				this._Log.error(`Failed to touch session: ${this.getSessionID(pRequest)} (${(pError && pError.message) || pError})`);
			});
			pRequest[this._Settings.SessionCookieName] = JSON.parse(pData);

			return fNext();
		});
	}

	/**
	 * Get a Temp Session
	 *
	 * @method getTempSession
	 * @params Querystring: ?SessionToken=temp_token_id
	 */
	getTempSession(pRequest, fNext)
	{
		if (!pRequest.query.SessionToken)
		{
			return fNext();
		}

		//validate SessionToken
		this._SessionStore.get(pRequest.query.SessionToken, (pError, pSessionIdentifierData) =>
		{
			if (!pSessionIdentifierData)
			{
				this._Log.error('Failed to find temp session token ' + pRequest.query.SessionToken);
				return fNext();
			}

			//verify that parent session is still active
			this._SessionStore.get(pSessionIdentifierData, (pError, pData) =>
			{
				if (pError)
				{
					this._Log.error('Failed to find session ' + pSessionIdentifierData + ' using temp token ' + pRequest.query.SessionToken);
					return fNext();
				}

				let tmpSession = {};
				try
				{
					tmpSession = JSON.parse(pData);
				} catch (ex) {
					this._Log.error('Invalid login request data: ' + ex);
					return fNext();
				}

				if (!tmpSession.LoggedIn)
				{
					this._Log.error('User session ' + pSessionIdentifierData + ' is no longer logged in!');
					return fNext();
				}

				this._Log.trace('Session import using temp session token',
				{
					SessionID: pRequest[this._Settings.SessionCookieName].SessionID,
					ParentSessionID: tmpSession.SessionID,
					TempSessionToken: pRequest.query.SessionToken,
				});

				//allow this user session to import attributes from parent session
				tmpSession.SessionID = pRequest[this._Settings.SessionCookieName].SessionID;

				this.setSessionLoginStatus(pRequest, tmpSession);

				return fNext();
			});
		});
	}

	/**
	* Get the currently logged in user
	*/
	checkSession(pRequest, fNext)
	{
		const tmpNext = (typeof(fNext) === 'function') ? fNext : () => { };

		if (!pRequest[this._Settings.SessionCookieName].LoggedIn)
		{
			pRequest.response.send({ IDUser: 0, UserID:0, LoggedIn: false });
			return tmpNext();
		}

		const tmpIDUser = pRequest[this._Settings.SessionCookieName].UserID;
		if (tmpIDUser < 1)
		{
			pRequest.response.send({ IDUser: 0, UserID:0, LoggedIn: false });
			return tmpNext();
		}

		pRequest.response.send(pRequest[this._Settings.SessionCookieName]);
		return tmpNext();
	}

	/**
	 * Create a session in memcache
	 *
	 * @method createSession
	 */
	 createSession(pRequest, fNext)
	 {
		// Create a new session UUID...
		const tmpUUID = libUUID.v4();
		let tmpSessionID = 'SES' + tmpUUID;
		let tmpNewSessionData = this.formatEmptyUserPacket(tmpSessionID, tmpUUID);

		if (pRequest.SessionOverrideData)
		{
			this._Log.info('SessionOverride data is specified.');

			tmpSessionID = pRequest.SessionOverrideData.SessionID;
			tmpNewSessionData = pRequest.SessionOverrideData;
		}

		this._Log.info('Creating a new session', { SessionID: tmpSessionID });

		// This is the state stored in Memcached
		// We store this much to prevent roundtrips to the database each request
		const tmpNewSessionDataString = JSON.stringify(tmpNewSessionData);

		const tmpCookieDomain = this.getWildcardCookieDomain(pRequest);

		this._SessionStore.get(tmpSessionID, (pError, pData) =>
		{
			if (pError || !pData)
			{
				//this._Log.trace('Error checking if session exists in memcache' + pError, { SessionID: tmpSessionID });
				this._SessionStore.set(tmpSessionID, tmpNewSessionDataString, this._Settings.SessionTimeout, (pError) =>
				{
					if (pError)
					{
						this._Log.trace('Error setting session: ' + (pError || 'no data returned from session provider'), { SessionID: tmpSessionID });
					}
					pRequest[this._Settings.SessionCookieName] = tmpNewSessionData;
					this.setCookie(pRequest, this._Settings.SessionCookieName, tmpNewSessionData.SessionID,
					{
						path: '/',
						maxAge: this._Settings.SessionTimeout,
						httpOnly: true,
						domain: tmpCookieDomain,
					});
					return fNext();
				});
				return;
			}

			//this._Log.trace('Session UUID collision.. this should NEVER happen', { SessionID: tmpSessionID, SessionData: pData });
			this._SessionStore.replace(tmpSessionID, tmpNewSessionDataString, 600, (pError) =>
			{
				if (pError)
				{
					this._Log.trace('Error replacing session: ' + pError, { SessionID: tmpSessionID });
				}
				pRequest[this._Settings.SessionCookieName] = tmpNewSessionData;
				this.setCookie(pRequest, this._Settings.SessionCookieName, tmpNewSessionData.SessionID,
				{
					path: '/',
					maxAge: this._Settings.SessionTimeout,
					httpOnly: true,
					domain: tmpCookieDomain,
				});
				return fNext();
			});
		});
	}

	/**
	 * Set the session login status
	 *
	 * @method setSessionLoginStatus
	 * @param {Object} pRequest The request object to set a status on
	 * @param {Boolean} pStatus The status of being logged in (true or false)
	 * @param {String} pRole The role of the user
	 */
	setSessionLoginStatus(pRequest, pUserPacket, fOptionalCallback)
	{
		if (!pUserPacket.SessionID)
		{
			//set the SessionID using cookie ID
			pUserPacket.SessionID = this.getSessionID(pRequest);
		}

		pRequest[this._Settings.SessionCookieName] = pUserPacket;

		this._Log.trace('Setting session status.',
		{
			SessionID: pRequest[this._Settings.SessionCookieName].SessionID,
			Session: pRequest[this._Settings.SessionCookieName],
		});
		this._SessionStore.replace(
			pRequest[this._Settings.SessionCookieName].SessionID,
			JSON.stringify(pRequest[this._Settings.SessionCookieName]),
			this._Settings.SessionTimeout,
			(pError) =>
			{
				if (pError)
				{
					this._Log.trace('foo', this._Settings)
					this._Log.trace('Error setting session status: ' + pError,
					{
						SessionID: pRequest[this._Settings.SessionCookieName].SessionID,
						Session: pRequest[this._Settings.SessionCookieName],
					});
				}

				if (typeof(fOptionalCallback) == 'function')
				{
					return fOptionalCallback(pError);
				}
			});
	}

	/**
	 * Log session state on Request
	 */
	logSession(pRequest, fNext)
	{
		if (this._PassthroughURLs.has(pRequest.url))
		{
			return fNext();
		}

		this._Log.info('Request',
		{
			ClientIP: this.getRemoteAddress(pRequest),
			RequestUUID: pRequest.RequestUUID,
			RequestURL: pRequest.url,
			SessionID: pRequest[this._Settings.SessionCookieName].SessionID,
			CustomerID: pRequest[this._Settings.SessionCookieName].CustomerID,
			UserID: pRequest[this._Settings.SessionCookieName].UserID,
		});
		// This duplicates the session data for the Meadow endpoints //TODO: change meadow to use this._Settings.SessionCookieName
		pRequest.SessionData = pRequest[this._Settings.SessionCookieName];

		return fNext();
	}

	/**
	 * Check the session login status
	 *
	 * @method checkIfLoggedIn
	 * @param {Object} pRequest The request object to check status on
	 */
	 checkIfLoggedIn(pRequest)
	 {
		if (!this.getSessionID(pRequest))
		{
			return false;
		}
		const session = pRequest[this._Settings.SessionCookieName];
		return session.LoggedIn && session.UserID > 0;
	 }

	 /**
	 * Log a user into the system using authenticator function
	 *
	 * @method authenticateUser
	 * @param {Object} pRequest The request object which contains a Credentials object
	 */
	authenticateUser(pRequest, fAuthenticator, fCallBack)
	{
		const remoteIP = pRequest.headers['x-forwarded-for'] || this.getRemoteAddress(pRequest);
		this._Log.trace('A user is attempting to login: ' + pRequest.Credentials.username,
		{
			RemoteIP: remoteIP,
			LoginID: pRequest.Credentials.username,
			Action: 'Authenticate-Attempt',
		});

		// This will fail if the username or password are equal to false.  Not exactly bad....
		if (!pRequest.Credentials ||
			!pRequest.Credentials.username ||
			!pRequest.Credentials.password)
		{
			this._Log.info('Authentication failure',
			{
				RemoteIP: remoteIP,
				LoginID: pRequest.Credentials.username,
				RequestID: pRequest.RequestUUID,
				Action: 'Authenticate Validation',
				Success: false,
			});
			return fCallBack('Bad username or password!');
		}

		fAuthenticator(pRequest.Credentials, (err, loginUserPacketResult) =>
		{
			if (!loginUserPacketResult)
			{
				loginUserPacketResult = this.formatEmptyUserPacket(this.getSessionID(pRequest));
			}

			const tmpStatus = (loginUserPacketResult.LoggedIn && loginUserPacketResult.UserID > 0) ?
				'success' :
				'failed';

			this._Log.trace('User login ' + tmpStatus,
			{
				LoginID: pRequest.Credentials.username,
				RequestID: pRequest.RequestUUID,
				Action: 'Authenticate',
				Success: tmpStatus,
			});

			//set the SessionID using cookie ID
			loginUserPacketResult.SessionID = this.getSessionID(pRequest);

			//set memcache session to login result
			this.setSessionLoginStatus(pRequest, loginUserPacketResult);

			return fCallBack(err, loginUserPacketResult);
		});
	}

	/**
	 * Default: Authenticate where credentials must match config
	 *
	 * @method defaultAuthenticator
	 */
	defaultAuthenticator(pCredentials, fCallBack)
	{
		if (pCredentials.username === this._Settings.DefaultUsername &&
			pCredentials.password === this._Settings.DefaultPassword)
		{
			return fCallBack(null, this.formatUserPacket(null, true, 'Administrator', 5, 1));
		}
		return fCallBack('Invalid username or password!');
	}

	/**
	 * Log a user out from the system
	 *
	 * @method deAuthenticateUser
	 */
	deAuthenticateUser(pRequest, fNext)
	{
		this._Log.info('Deauthentication success',
		{
			LoginID: pRequest[this._Settings.SessionCookieName].LoginID,
			RequestID: pRequest.RequestUUID,
			Action: 'Deauthenticate',
			Success: true,
		});
		const tmpUserPacket = this.formatEmptyUserPacket(pRequest[this._Settings.SessionCookieName].SessionID);
		this.setSessionLoginStatus(pRequest, tmpUserPacket);
		pRequest.response.send({ Success: true });
	}

	/**
	 * Checkout a session token which can be used by 3rd-party connection to use this User session
	 *
	 * @method getSessionToken
	 */
	getSessionToken(pRequest, fCallback)
	{
		this.checkoutSessionToken(pRequest, (err, token) =>
		{
			if (err)
			{
				//FIXME: :(
				pRequest.response.send({ Error: err });
			}
			else
			{
				pRequest.response.send({ Token: token });
			}

			return fCallback();
		});
	}

	/**
	 * Checkout a session token which can be used by 3rd-party connection to use this User session
	 *
	 * @method checkoutSessionToken
	 */
	checkoutSessionToken(pRequest, fCallback)
	{
		const tmpSession = pRequest[this._Settings.SessionCookieName];
		if (!tmpSession.LoggedIn)
		{
			return fCallback('User not logged in!');
		}

		const tmpUUID = 'TempSessionToken-' + libUUID.v4();

		this._SessionStore.set(tmpUUID, tmpSession.SessionID, this._Settings.SessionTempTokenTimeout, (pError) =>
		{
			if (pError)
			{
				this._Log.trace('Error checking out a session token!' + pError, { SessionID: tmpSession.SessionID });
			}
			else
			{
				this._Log.trace('Checked out a session token: ' + tmpUUID, { IDUser: tmpSession.UserID, SessionID: tmpSession.SessionID });
			}

			return fCallback(pError, tmpUUID);
		});
	}

	/**
	 * Lookup session from session store, but only retrieve related userID key
	 *
	 * @method getSessionUserID
	 */
	getSessionUserID(pSessionID, fCallback)
	{
		this._SessionStore.get(pSessionID, (pError, pData) =>
		{
			let tmpUserID = 0;
			if (pData)
			{
				const tmpSessionData = JSON.parse(pData);
				if (tmpSessionData.UserID)
				{
					tmpUserID = tmpSessionData.UserID;
				}
			}

			return fCallback(pError, tmpUserID);
		});
	}

	/**
	 * Get the public-facing server domain name
	 *
	 * @method getServerHostDomain
	 */
	getServerHostDomain(pRequest)
	{
		if (!pRequest ||
			!pRequest.headers)
		{
			this._Log.warn('getServerHostDomain -- request object missing headers!');
			return false;
		}

		let tmpHostDomain = '';
		if (pRequest.headers['origin']) //some reverse proxies will give us this header
		{
			//remove scheme
			tmpHostDomain = pRequest.headers['origin'].replace('http://', '').replace('https://', '');
		}
		else
		{
			tmpHostDomain = pRequest.headers.host;
		}

		//remove port (just want domain)
		return tmpHostDomain.replace(/:.*/, '');
	}

	/**
	 * If the domain is >3 tiers, then return a domain with only the first 3 tiers (default for shared auth with microservices architecture)
	 * e.g. myapp.mainapp.company.com -> mainapp.company.com
	 *
	 * @method getCookieDomain
	 */
	getWildcardCookieDomain(pRequest)
	{
		const tmpHostDomain = this.getServerHostDomain(pRequest);

		//skip setting cookie domain for mobile apps
		if (pRequest.headers['user-agent'] &&
			!!pRequest.headers['user-agent'].match(/iOS/))
		{
			return null;
		}

		const domainParts = tmpHostDomain.split('.');
		if (domainParts.length >= 3 && tmpHostDomain.indexOf('paviasystems')>0)
		{
			//For Pavia domains (e.g. *.headlight.paviasystems.com)
			return domainParts[domainParts.length-3] + '.' + domainParts[domainParts.length-2] + '.' + domainParts[domainParts.length-1];
		}
		if (domainParts.length >= 2 && tmpHostDomain.indexOf('paviasystems')<0)
		{
			//For other domains (e.g. *.idoteconstruction.com)
			return domainParts[domainParts.length-2] + '.' + domainParts[domainParts.length-1];
		}
		//else don't use wildcards
		return null;
	}

	//TODO: make this extensible
	formatUserPacketFromRecord(pUserRecord)
	{
		return this.formatUserPacket(
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
	formatEmptyUserPacket(pSessionID)
	{
		return this.formatUserPacket(
			pSessionID, //SessionID
			false, //LoggedIn
			'Unauthenticated', //UserRole
			-1, //UserRoleIndex
			0, //UserID
			0, //CustomerID
			'', //Title
			'', //NameFirst
			'', //NameLast
			'', //Email
		);
	}

	//TODO: make this extensible
	formatUserPacket(pSessionID, pStatus, pRole, pRoleIndex, pUserID, pCustomerID, pTitle, pNameFirst, pNameLast, pEmail)
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

	/**
	 * Lookup session from session store. Retrieve related user records
	 *
	 * @method getSessionUserID
	 */
	getActiveUserSessions(pSessionIDs, fCallback)
	{
		const tmpActiveUsers = [];
		libAsync.eachSeries(pSessionIDs, (pSessionID, fNext) =>
		{
			this._SessionStore.get(pSessionID, (pError, pData) =>
			{
				if (pData)
				{
					const tmpSessionData = JSON.parse(pData);

					// This happen when user logout. SessionID still exists in the memcache but UserID = 0.
					if (tmpSessionData.UserID == 0)
					{
						return fNext();
					}

					if (libMoment(tmpSessionData.LastLoginTime).format('YYYY-MM-DD HH:mm:ss') >= libMoment().subtract(15, 'minutes').format('YYYY-MM-DD HH:mm:ss'))
					{
						tmpActiveUsers.push(tmpSessionData);
					}
				}

				return fNext();
			});

		}, (pError) =>
		{
			if (pError)
			{
				return fCallback(pError);
			}

			return fCallback(null, tmpActiveUsers);
		});
	}

	get passthroughURLs()
	{
		return Array.from(this._PassthroughURLs);
	}

	set passthroughURLs(pURLs)
	{
		return this._PassthroughURLs = new Set(pURLs);
	}

	addPassthroughURLs(pURLs)
	{
		pURLs.forEach((pURL) => this._PassthroughURLs.add(pURL));
	}

	get sessionStore()
	{
		return this._SessionStore;
	}
}

module.exports = OratorSession;

