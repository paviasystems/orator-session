/**
* The MemcachedStrategy Module
*
* @author Jason Hillier <jason@paviasystems.com>
* @class MemcachedStrategy
* @constructor
*/
var libFS = require('fs');
var MemcachedStrategy = function()
{
	function createNew(pFable)
	{
		// If a valid fable object isn't passed in, return a constructor
		if ((typeof(pFable) !== 'object') || (!pFable.hasOwnProperty('fable')))
			return {new: createNew};
		var _Log = pFable.log;
		var _Settings = pFable.settings;

		var libMemcached = require('memcached');
		var _Memcached = false;
		_Log.trace('Session Strategy is Memcached: '+_Settings.MemcachedURL);
		_Memcached = new libMemcached(_Settings.MemcachedURL);

		var get = function(pIDSession, fCallback)
		{
			return _Memcached.get(pIDSession, fCallback);
		}

		var touch = function(pIDSession, pTimeout, fCallback)
		{
			return _Memcached.touch(pIDSession, pTimeout, fCallback);
		}

		var set = function(pIDSession, pSessionDataString, pTimeout, fCallback)
		{
			return _Memcached.set(pIDSession, pSessionDataString, pTimeout, fCallback);
		}

		var replace = function(pIDSession, pSessionDataString, pTimeout, fCallback)
		{
			return _Memcached.replace(pIDSession, pSessionDataString, pTimeout, fCallback);
		}

		var del = function(pKey, fCallback)
		{
			return _Memcached.del(pKey, fCallback);
		}

		/**
		* Container Object for our Factory Pattern
		*/
		var tmpMemcachedStrategy = (
		{
			get: get,
			touch: touch,
			set: set,
			replace: replace,
			del: del,
			new: createNew
		});

		return tmpMemcachedStrategy;
	}

	return createNew();
};

module.exports = new MemcachedStrategy();
