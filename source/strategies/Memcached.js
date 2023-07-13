/**
* The MemcachedStrategy Module
*
* @author Jason Hillier <jason@paviasystems.com>
* @class MemcachedStrategy
* @constructor
*/
const libFS = require('fs');
const libMemcached = require('memcached');

class MemcachedStrategy
{
	constructor(pFable)
	{
		if ((typeof(pFable) !== 'object') || !('fable' in pFable))
		{
			throw new Error(`Invalid fable instance passed to OratorSession constructor. (${typeof(pFable)})`);
		}

		this._Fable = pFable.fable; // parameter may not be a fable object, but "has" fable anyway
		this._Settings = this._Fable.settings || { };
		this._Log = this._Fable.log;

		this._Log.trace('Session Strategy is Memcached: ' + this._Settings.MemcachedURL);
		this._Memcached = new libMemcached(this._Settings.MemcachedURL);
	}

	get(pIDSession, fCallback)
	{
		return this._Memcached.get(pIDSession, fCallback);
	}

	touch(pIDSession, pTimeout, fCallback)
	{
		return this._Memcached.touch(pIDSession, pTimeout, fCallback);
	}

	set(pIDSession, pSessionDataString, pTimeout, fCallback)
	{
		return this._Memcached.set(pIDSession, pSessionDataString, pTimeout, fCallback);
	}

	replace(pIDSession, pSessionDataString, pTimeout, fCallback)
	{
		return this._Memcached.replace(pIDSession, pSessionDataString, pTimeout, fCallback);
	}

	del(pKey, fCallback)
	{
		return this._Memcached.del(pKey, fCallback);
	}
}

module.exports = MemcachedStrategy;
