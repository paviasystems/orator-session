/**
* Unit tests for Session state on Orator Server
*
* @license     MIT
*
* @author      Jason Hillier <jason@paviasystems.com>
*/

const Chai = require('chai');
const Expect = Chai.expect;
const Assert = Chai.assert;
const Sinon = require('sinon');
const Koa = require('koa');
const libSuperTest = require('supertest');

const Fable = require('fable');

const OratorSessionKoa = require('../source/index').OratorSessionKoa;

const _MockSettings = (
{
	Product: 'MockOratorAlternate',
	ProductVersion: '0.0.0',
	APIServerPort: 8999,
	SessionTimeout: 60,
	SessionStrategy: 'InMemory',
	DefaultUsername: 'user',
	DefaultPassword: 'test',
});

function newAgent()
{
	return libSuperTest.agent(`http://localhost:${_MockSettings.APIServerPort}/`);
}

suite
(
	'OratorSessionKoa',
	function()
	{
		let _OratorSession;
		let _SessionID;
		const _SharedAgent = newAgent();

		setup
		(
			function()
			{
        const fable = new Fable(_MockSettings);
				_OratorSession = new OratorSessionKoa(fable.settings, fable.log);
			}
		);

		suite
		(
			'Object Sanity',
			function()
			{
				test
				(
					'initialize should build a happy little object',
					function()
					{
						Expect(_OratorSession)
							.to.be.an('object', 'Orator-Session should initialize as an object directly from the require statement.');
					}
				);
			}
		);

		suite
		(
			'InMemory Orator Session with Koa web Server',
			function()
			{
				let _Fable;
				let _Koa;
				let _OratorSession;
				let _Server;

				test
				(
					'Initialize Server',
					function(done)
					{
						_Fable = new Fable(_MockSettings);
						_Koa = new Koa();
						_OratorSession = new OratorSessionKoa(_Fable.settings, _Fable.log);
						_Koa.use(_OratorSession.middleware)
						_Koa.use((ctx, next) => {
							if (_OratorSession.checkIfLoggedIn(ctx))
								ctx.status = 200;
							else
								ctx.status = 401;
							ctx.body = 'TEST';
						})
						_Server = _Koa.listen(_MockSettings.APIServerPort);
						_Server.on('listening', done)
					}
				);
				test
				(
					'Send test request to create session',
					function(fDone)
					{
						_SharedAgent
								.get('TEST')
								.end(
									function (pError, pResponse)
									{
										Expect(pError).to.not.exist;
										Expect(pResponse.text)
											.to.contain('TEST');
										Expect(pResponse.statusCode)
											.to.equal(401);
										fDone();
									}
								);
					}
				);
				test
				(
					'Shutdown koa',
					function()
					{
						_Server.close();
					}
				);
			}
		);
	}
);
