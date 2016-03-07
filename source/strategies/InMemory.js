/**
* The InMemoryStrategy Module
*
* @author Jason Hillier <jason@paviasystems.com>
* @class InMemoryStrategy
* @constructor
*/

// Global hashmap
var _MemorySessionMap = {};

var InMemoryStrategy = function()
{
	function createNew(pFable)
	{
		// If a valid fable object isn't passed in, return a constructor
		if ((typeof(pFable) !== 'object') || (!pFable.hasOwnProperty('fable')))
			return {new: createNew};
		var _Log = pFable.log;
		var _Settings = pFable.settings;

		_Log.trace('Session Strategy is InMemory');

		var PRUNE_OPS = 100; //Prune session map every X set operations
		var _PruneCounter = 0;

		// Iterate through memory session map, cleaning up keys that have expired
		var pruneSessionStore = function()
		{
			var tmpKeys = Object.keys(_MemorySessionMap);

			tmpKeys.forEach(checkTimeout);
		}

		var checkTimeout = function(pIDSession)
		{
			if (_MemorySessionMap[pIDSession])
			{
				//check timeout
				var tmpElapsed = Date.now() - _MemorySessionMap[pIDSession].Timestamp;
				if (tmpElapsed > _MemorySessionMap[pIDSession].Timeout * 1000)
				{
					//Delete session key from memory map if timeout is exceeded.
					delete _MemorySessionMap[pIDSession];
				}
			}
		}

		//
		var get = function(pIDSession, fCallback)
		{
			if (typeof(pIDSession) !== 'string')
				return fCallback('pIDSession must be a string!');

			checkTimeout(pIDSession);

			if (_MemorySessionMap[pIDSession])
			{
				//check timeout
				return fCallback(null, _MemorySessionMap[pIDSession].Content)
			}

			return fCallback(null);
		}

		var touch = function(pIDSession, pTimeout, fCallback)
		{
			if (typeof(pIDSession) !== 'string')
				return fCallback('pIDSession must be a string!');

			if (!_MemorySessionMap[pIDSession])
				return fCallback('Session ID not found!');
			
			if (_MemorySessionMap[pIDSession])
			{
				_MemorySessionMap[pIDSession].Timestamp = Date.now();
				_MemorySessionMap[pIDSession].Timeout = pTimeout;
			}

			return fCallback(null);
		}

		var set = function(pIDSession, pSessionDataString, pTimeout, fCallback)
		{
			if (typeof(pIDSession) !== 'string')
				return fCallback('pIDSession must be a string!');
			if (typeof(pSessionDataString) !== 'string')
				return fCallback('pIDSession must be a string!');

			if (_MemorySessionMap[pIDSession])
			{
				return fCallback('Session ID key already exists! Use replace instead.')
			}

			if (++_PruneCounter > PRUNE_OPS)
			{
				_PruneCounter = 0;

				_Log.trace('Pruning in-memory session store...');
				pruneSessionStore();
			}

			return replace(pIDSession, pSessionDataString, pTimeout, fCallback);
		}

		var replace = function(pIDSession, pSessionDataString, pTimeout, fCallback)
		{
			if (typeof(pIDSession) !== 'string')
				return fCallback('pIDSession must be a string!');
			if (typeof(pSessionDataString) !== 'string')
				return fCallback('pIDSession must be a string!');

			_MemorySessionMap[pIDSession] = {
				Content: pSessionDataString,
				Timestamp: Date.now(),
				Timeout: pTimeout
			};

			return fCallback(null);
		}

		/**
		* Container Object for our Factory Pattern
		*/
		var tmpInMemoryStrategy = (
		{
			get: get,
			touch: touch,
			set: set,
			replace: replace,
			new: createNew
		});

		return tmpInMemoryStrategy;
	}

	return createNew();
};

module.exports = new InMemoryStrategy();
