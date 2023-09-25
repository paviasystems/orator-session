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
const libSuperTest = require('supertest');

const Fable = require('fable');

const OratorSessionFable = require('../source/index').OratorSessionFable;

const _MockSettings = (
{
	Product: 'MockOratorAlternate',
	ProductVersion: '0.0.0',
	APIServerPort: 8999,
	SessionTimeout: 60,
	SessionStrategy: 'Memcached',
	MemcachedURL: '127.0.0.1:11211',
	DefaultUsername: 'user',
	DefaultPassword: 'test',
});

function newAgent()
{
	return libSuperTest.agent(`http://localhost:${_MockSettings.APIServerPort}/`);
}

async function newOrator(fable)
{
	fable.serviceManager.addServiceType('OratorServiceServer', require('orator-serviceserver-restify'));
	fable.serviceManager.instantiateServiceProvider('OratorServiceServer', { });

	// Now add the orator service to Fable
	fable.serviceManager.addServiceType('Orator', require('orator'));
	let orator = fable.serviceManager.instantiateServiceProvider('Orator', { });

	return new Promise((resolve, reject) =>
	{
		fable.Utility.waterfall(
		[
			orator.initialize.bind(orator),
			(fStageComplete)=>
			{
				const Restify = require('restify');
				//FIXME: given this is required, how do we want enforce it is included?
				orator.webServer.use(Restify.plugins.queryParser());
				return fStageComplete();
			},
			//orator.startService.bind(orator),
		],
		(pError)=>
		{
			if (pError)
			{
				fable.log.error('Error initializing Orator Service Server: ' + pError.message, pError);
				return reject(pError);
			}
			fable.log.info('Orator Service Server Initialized.');
			resolve(orator);
		});
	});
}

suite
(
	'OratorSessionFable',
	function()
	{
		let _Orator;
		let _OratorSession;
		const _SharedAgent = newAgent();

		setup
		(
			function()
			{
				_OratorSession = new OratorSessionFable(new Fable(_MockSettings));
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
			'Memcached Orator Session with Orator web Server',
			function()
			{
				let _Fable;
				let _Orator;
				let _OratorSession;

				test
				(
					'Initialize Orator',
					async function()
					{
						_Fable = new Fable(_MockSettings);
						_Orator = await newOrator(_Fable);
						_Orator.webServer.use(require('restify-cookies').parse);
					}
				);
				test
				(
					'Start Orator web Server',
					function()
					{
						_OratorSession = new OratorSessionFable(_Orator);
						_OratorSession.connectRoutes(_Orator.webServer);

						//setup a route to use for testing
						_Orator.webServer.get(
							'/TEST',
							function (pRequest, pResponse, fNext)
							{
								if (_OratorSession.checkIfLoggedIn(pRequest))
									pResponse.statusCode = 200;
								else
									pResponse.statusCode = 401;
								pResponse.send('TEST');
								fNext();
							}
						);

						//setup a route to use for testing Authentication
						_Orator.webServer.get(
							'/AUTH',
							function (pRequest, pResponse, fNext)
							{
								pRequest.Credentials = (
								{
									username: pRequest.query.username,
									password: pRequest.query.password
								});

								_OratorSession.authenticateUser(pRequest, _OratorSession.defaultAuthenticator.bind(_OratorSession), function(err, result)
								{
									if (result &&
										result.LoggedIn)
									{
										pResponse.send('Success');
									}
									else
									{
										pResponse.send('Failed');
									}

									fNext();
								});
							}
						);

						_Orator.startWebServer();
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
					'Send request to authenticate a user (bad login)',
					function(fDone)
					{
						_SharedAgent
								.get('AUTH?username=' +
									encodeURIComponent('bad') + '&password=' +
									encodeURIComponent('wrong'))
								.end(
									function (pError, pResponse)
									{
										Expect(pError).to.not.exist;
										Expect(pResponse.text)
											.to.contain('Failed');
										fDone();
									}
								);
					}
				);
				test
				(
					'Send request to authenticate a user',
					function(fDone)
					{
						_SharedAgent
								.get('AUTH?username=' +
									encodeURIComponent(_MockSettings.DefaultUsername) + '&password=' +
									encodeURIComponent(_MockSettings.DefaultPassword))
								.end(
									function (pError, pResponse)
									{
										Expect(pError).to.not.exist;
										Expect(pResponse.text)
											.to.contain('Success');
										fDone();
									}
								);
					}
				);
				test
				(
					'Send request to verify authorized users session',
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
											.to.equal(200);
										fDone();
									}
								);
					}
				);

				var tmpSessionToken = '';
				test
				(
					'Checkout a temp session token',
					function(fDone)
					{
						_SharedAgent
							.get('1.0/CheckoutSessionToken')
							.end(
								function (pError, pResponse)
								{
									Expect(pError).to.not.exist;
									Expect(pResponse.body.Error).to.not.exist;
									Expect(pResponse.body.Token)
										.to.contain('TempSessionToken-');
									Expect(pResponse.statusCode)
										.to.equal(200);

									tmpSessionToken = pResponse.body.Token;

									fDone();
								}
							);
					}
				);
				let tokenAgent;
				test
				(
					'Test session token',
					function(fDone)
					{
						tokenAgent = newAgent();
						tokenAgent
							.get('1.0/CheckSession?SessionToken=' + tmpSessionToken)
							.end(
								function (pError, pResponse)
								{
									Expect(pError).to.not.exist;
									Expect(pResponse.body.Error).to.not.exist;
									Expect(pResponse.body.LoggedIn)
										.to.equal(true);
									Expect(pResponse.statusCode)
										.to.equal(200);
									fDone();
								}
							);
					}
				);

				test
				(
					'Test Deauthenticate',
					function(fDone)
					{
						_SharedAgent
							.get('1.0/Deauthenticate')
							.end(
								function (pError, pResponse)
								{
									Expect(pError).to.not.exist;
									Expect(pResponse.body.Error).to.not.exist;
									Expect(pResponse.body.Success)
										.to.equal(true);
									Expect(pResponse.statusCode)
										.to.equal(200);
									fDone();
								}
							);
					}
				);
				test
				(
					'Ensure logged-out status is maintained',
					function(fDone)
					{
						_SharedAgent
							.get('1.0/CheckSession')
							.end(
								function (pError, pResponse)
								{
									Expect(pError).to.not.exist;
									Expect(pResponse.body.Error).to.not.exist;
									Expect(pResponse.body.LoggedIn)
										.to.equal(false);
									Expect(pResponse.statusCode)
										.to.equal(200);
									fDone();
								}
							);
					}
				);
				test
				(
					'Ensure logged-in status of token user is maintained',
					function(fDone)
					{
						tokenAgent
							.get('1.0/CheckSession')
							.end(
								function (pError, pResponse)
								{
									Expect(pError).to.not.exist;
									Expect(pResponse.body.Error).to.not.exist;
									Expect(pResponse.body.LoggedIn)
										.to.equal(true);
									Expect(pResponse.statusCode)
										.to.equal(200);
									fDone();
								}
							);
					}
				);
				test
				(
					'Request a session that doesnt exist',
					function(fDone)
					{
						const doesNotExistAgent = newAgent();
						doesNotExistAgent
							.get('1.0/CheckSession')
							.set( 'Cookie', 'UserSession=DoesNotExist' )
							.end(
								function (pError, pResponse)
								{
									Expect(pError).to.not.exist;
									Expect(pResponse.body.Error).to.not.exist;
									Expect(pResponse.body.LoggedIn)
										.to.equal(false);
									Expect(pResponse.statusCode)
										.to.equal(200);
									fDone();
								}
							);
					}
				);
				test
				(
					'Shutdown Orator WebServer',
					function()
					{
						_Orator.stopWebServer();
					}
				);
			}
		);
	}
);
