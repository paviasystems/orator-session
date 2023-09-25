/**
* Generalized session state and auth manager for Orator/restify
*
* @class OratorSession
* @constructor
*/

const OratorSession = require('./Orator-Session.js');

class OratorSessionKoa extends OratorSession
{
	constructor(settings, log)
	{
		super(settings, log);
	}

	/**
	* Return array of koa middleware for OratorSession
	*
	* @method middleware
	*/
	middleware()
	{
		return [getSession, getTempSession, logSession]
	}

	getRemoteAddress(ctx)
	{
		return ctx.response.connection.remoteAddress;
	}

	getCookie(ctx, name)
	{
		return ctx.cookies.get(name);
	}

	setCookie(ctx, ...args)
	{
		ctx.cookies.set(...args)
	}
}

module.exports = OratorSessionKoa;
