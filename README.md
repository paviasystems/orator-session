# Orator

Orator-Session, meant to provide session and user auth compatible with Orator web servers (Orator 4.x and later). It exposes two modules.

## OratorSessionFable

For use with Fable / Restify, `OratorSessionFable` assumes the existence of both a query string parser (provided by Fable) and a cookie parser (the responsibility of the caller).

Requires Fable 3.x or later.

Calling `connectRoutes(webServer)` applies middleware to the server and registers several routes for managing sessions.

Usage:

```
const pFable = (...create Fable instance...);

const CookieParser = require('restify-cookies').parse;
pFable.webServer.use(CookieParser);

const OratorSessionFable = require('orator-session').OratorSessionFable;
const SessionManager = new OratorSessionFable(pFable);
SessionManager.connectRoutes(pFable.webServer);
```

## OratorSessionKoa

For use with Koa, without opting into the entire Fable ecosystem, `OratorSessionKoa` takes a lighter approach. Calling `.middleware()` returns an array of middleware fuctions for use with a koa server.

Usage:

```
import uuid from 'uuid'
import config from 'config'
import log from './log.js'

import { OratorSessionKoa } from 'orator-session'

const app = new Koa(...)

const sessionManager = new OratorSessionKoa(config, log, uuid)
app.use(sessionManager.middleware())
```

## Testing

The automated tests assume that memcached is running on `localhost:11211`. Be sure to start it if you expect them to pass.
