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

		this.middleware = (ctx, next) =>
		{
			this.getSession(ctx, () =>
			{
				this.getTempSession(ctx, () =>
				{
					this.logSession(ctx, next)
				})
			})
		};
	}

	getRemoteAddress(ctx)
	{
		return ctx.res.connection.remoteAddress;
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
