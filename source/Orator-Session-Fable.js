/**
* Generalized session state and auth manager for Orator/restify
*
* @class OratorSession
* @constructor
*/

const OratorSession = require('./Orator-Session.js');

class OratorSessionFable extends OratorSession
{
	constructor(pFable)
	{
		if ((typeof(pFable) !== 'object') || !('fable' in pFable))
		{
			throw new Error(`Invalid fable instance passed to OratorSession constructor. (${typeof(pFable)})`);
		}

		super(pFable.fable?.settings || pFable.settings || {}, pFable.log);

		this._Fable = pFable;
	}

	/**
	* Wire up middleware and routes for the OratorSession
	*
	* @method connectRoutes
	* @param {Object} pRestServer The Restify server object to add routes to
	*/
	connectRoutes(pRestServer)
	{
		const restifyCall = (functionName) => (request, response, next) =>
		{
			request.response = response;
			this[functionName](request, next);
		}

		// This means the getSession is called on every request
		pRestServer.use(restifyCall('getSession'));

		// This checks for a temp session token on every request
		pRestServer.use(restifyCall('getTempSession'));

		// This logs each request after the session is set
		pRestServer.use(restifyCall('logSession'));

		// Deauthenticate
		pRestServer.get('/1.0/Deauthenticate', restifyCall('deAuthenticateUser'));

		pRestServer.get('/1.0/CheckSession', restifyCall('checkSession'));

		//checkout a temp token which allows 3rd party connection to use this session
		pRestServer.get('/1.0/CheckoutSessionToken', restifyCall('getSessionToken'));

		//We could add routes here to support different auth-types
		// depending on configuration (WWW-Auth for example)

		//In case of an Orator proxy, these endpoints need to be omitted
		if (typeof(this._Fable.omitProxyRoute) == 'function')
		{
			this._Fable.omitProxyRoute('1.0/Deauthenticate');
			this._Fable.omitProxyRoute('1.0/CheckSession');
			this._Fable.omitProxyRoute('1.0/CheckoutSessionToken');
		}
	}

	getRemoteAddress(pRequest)
	{
		return pRequest.connection.remoteAddress;
	}

	getCookie(pRequest, name)
	{
		return pRequest.cookies[name];
	}

	setCookie(pRequest, ...args)
	{
		pRequest.response.setCookie(...args);
	}
}

module.exports = OratorSessionFable;
