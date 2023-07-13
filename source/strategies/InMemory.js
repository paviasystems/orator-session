/**
* The InMemoryStrategy Module
*
* @author Jason Hillier <jason@paviasystems.com>
* @class InMemoryStrategy
* @constructor
*/

// Global hashmap
const PRUNE_OPS = 100; //Prune session map every X set operations

class InMemoryStrategy
{
	constructor(pFable)
	{
		if ((typeof(pFable) !== 'object') || !('fable' in pFable))
		{
			throw new Error(`Invalid fable instance passed to OratorSession constructor. (${typeof(pFable)})`);
		}

		this._Fable = pFable.fable; // parameter may not be a fable object, but "has" fable anyway
		this._Settings = pFable.settings || { };
		this._Log = pFable.log;

		this._Log.trace('Session Strategy is InMemory');

		this._MemorySessionMap = { };
		this._PruneCounter = 0;
	}

	// Iterate through memory session map, cleaning up keys that have expired
	pruneSessionStore()
	{
		const tmpKeys = Object.keys(this._MemorySessionMap);

		tmpKeys.forEach(this.checkTimeout.bind(this));
	}

	checkTimeout(pIDSession)
	{
		if (this._MemorySessionMap[pIDSession])
		{
			// check timeout
			const tmpElapsed = Date.now() - this._MemorySessionMap[pIDSession].Timestamp;
			if (tmpElapsed > this._MemorySessionMap[pIDSession].Timeout * 1000)
			{
				// Delete session key from memory map if timeout is exceeded.
				delete this._MemorySessionMap[pIDSession];
			}
		}
	}

	get(pIDSession, fCallback)
	{
		if (typeof(pIDSession) !== 'string')
		{
			return fCallback('pIDSession must be a string!');
		}

		this.checkTimeout(pIDSession);

		if (this._MemorySessionMap[pIDSession])
		{
			// check timeout
			return fCallback(null, this._MemorySessionMap[pIDSession].Content)
		}

		return fCallback(null);
	}

	touch(pIDSession, pTimeout, fCallback)
	{
		if (typeof(pIDSession) !== 'string')
		{
			return fCallback('pIDSession must be a string!');
		}

		if (!this._MemorySessionMap[pIDSession])
		{
			return fCallback('Session ID not found!');
		}

		if (this._MemorySessionMap[pIDSession])
		{
			this._MemorySessionMap[pIDSession].Timestamp = Date.now();
			this._MemorySessionMap[pIDSession].Timeout = pTimeout;
		}

		return fCallback(null);
	}

	set(pIDSession, pSessionDataString, pTimeout, fCallback)
	{
		if (typeof(pIDSession) !== 'string')
		{
			return fCallback('pIDSession must be a string!');
		}
		if (typeof(pSessionDataString) !== 'string')
		{
			return fCallback('pIDSession must be a string!');
		}

		if (this._MemorySessionMap[pIDSession])
		{
			return fCallback('Session ID key already exists! Use replace instead.')
		}

		if (++this._PruneCounter > PRUNE_OPS)
		{
			this._PruneCounter = 0;

			this._Log.trace('Pruning in-memory session store...');
			this.pruneSessionStore();
		}

		return this.replace(pIDSession, pSessionDataString, pTimeout, fCallback);
	}

	replace(pIDSession, pSessionDataString, pTimeout, fCallback)
	{
		if (typeof(pIDSession) !== 'string')
		{
			return fCallback('pIDSession must be a string!');
		}
		if (typeof(pSessionDataString) !== 'string')
		{
			return fCallback('pIDSession must be a string!');
		}

		this._MemorySessionMap[pIDSession] =
		{
			Content: pSessionDataString,
			Timestamp: Date.now(),
			Timeout: pTimeout,
		};

		return fCallback(null);
	}

	del(pKey, fCallback)
	{
		delete this._MemorySessionMap[pKey];
		return fCallback();
	}
}

module.exports = InMemoryStrategy;
