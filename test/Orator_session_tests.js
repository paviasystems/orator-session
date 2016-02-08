/**
* Unit tests for Session state on Orator Server
*
* @license     MIT
*
* @author      Jason Hillier <jason@paviasystems.com>
*/

var Chai = require("chai");
var Expect = Chai.expect;
var Assert = Chai.assert;

var _MockSettings = (
{
	Product: 'MockOratorAlternate',
	ProductVersion: '0.0.0',
	APIServerPort: 8080,
	"SessionTimeout":60,
	"MemcachedURL":"192.168.99.100:11211",
	"DefaultUsername": "user",
	"DefaultPassword": "test"
});

var libSuperTest = require('supertest').agent('http://localhost:' + _MockSettings.APIServerPort + '/');
var libSuperTest2 = require('supertest').agent('http://localhost:' + _MockSettings.APIServerPort + '/');

suite
(
	'OratorSession',
	function()
	{
		var _Orator;
		var _OratorSession;

		setup
		(
			function()
			{
				_OratorSession = require('../source/Orator-Session.js').new(_MockSettings);
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
			'Orator Session with Orator web Server',
			function()
			{
				var _Orator;
				var _OratorSession;

				test
				(
					'Initialize Orator',
					function()
					{
						_Orator = require('orator').new(_MockSettings);
					}
				);
				test
				(
					'Start Orator web Server',
					function()
					{
						_OratorSession = require('../source/Orator-Session.js').new(_Orator);
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

								_OratorSession.authenticateUser(pRequest, _OratorSession.defaultAuthenticator, function(err, result)
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
						libSuperTest
								.get('TEST')
								.end(
									function (pError, pResponse)
									{
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
						libSuperTest
								.get('AUTH?username=' +
									encodeURIComponent('bad') + '&password=' +
									encodeURIComponent('wrong'))
								.end(
									function (pError, pResponse)
									{
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
						libSuperTest
								.get('AUTH?username=' +
									encodeURIComponent(_MockSettings.DefaultUsername) + '&password=' +
									encodeURIComponent(_MockSettings.DefaultPassword))
								.end(
									function (pError, pResponse)
									{
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
						libSuperTest
								.get('TEST')
								.end(
									function (pError, pResponse)
									{
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
						libSuperTest
							.get('1.0/CheckoutSessionToken')
							.end(
								function (pError, pResponse)
								{
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
				test
				(
					'Test session token',
					function(fDone)
					{
						libSuperTest2
							.get('1.0/CheckSession?SessionToken=' + tmpSessionToken)
							.end(
								function (pError, pResponse)
								{
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
						libSuperTest
							.get('1.0/Deauthenticate')
							.end(
								function (pError, pResponse)
								{
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
						libSuperTest
							.get('1.0/CheckSession')
							.end(
								function (pError, pResponse)
								{
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
						libSuperTest2
							.get('1.0/CheckSession')
							.end(
								function (pError, pResponse)
								{
									Expect(pResponse.body.LoggedIn)
										.to.equal(true);
									Expect(pResponse.statusCode)
										.to.equal(200);
									fDone();
								}
							);
					}
				);
			}
		);
	}
);
