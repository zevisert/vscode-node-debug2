/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'path';

import {DebugProtocol} from 'vscode-debugprotocol';

import * as testUtils from './testUtils';
import * as testSetup from './testSetup';

const DATA_ROOT = testSetup.DATA_ROOT;

suite('Node Debug Adapter etc', () => {

    let dc: testUtils.Node2DebugClient;
    setup(() => {
        return testSetup.setup()
            .then(_dc => dc = _dc);
    });

    teardown(() => {
        return testSetup.teardown();
    });

    suite('basic', () => {
        test('unknown request should produce error', done => {
            dc.send('illegal_request').then(() => {
                done(new Error('does not report error on unknown request'));
            }).catch(() => {
                done();
            });
        });
    });

    suite('initialize', () => {
        test('should return supported features', () => {
            return dc.initializeRequest().then(response => {
                assert.equal(response.body.supportsConfigurationDoneRequest, true);
            });
        });

        test('should produce error for invalid \'pathFormat\'', () => {
            return dc.initializeRequest({
                adapterID: 'mock',
                linesStartAt1: true,
                columnsStartAt1: true,
                pathFormat: 'url'
            }).then(response => {
                throw new Error('does not report error on invalid \'pathFormat\' attribute');
            }).catch(err => {
                // error expected
            });
        });
    });

    suite('launch', () => {
		// #11
        test.skip('should run program to the end', () => {
            const PROGRAM = path.join(DATA_ROOT, 'program.js');

            return Promise.all([
                dc.configurationSequence(),
                dc.launch({ program: PROGRAM }),
                dc.waitForEvent('terminated')
            ]);
        });

        test('should stop on entry', () => {
            const PROGRAM = path.join(DATA_ROOT, 'program.js');
            const ENTRY_LINE = 1;

            return Promise.all([
                dc.configurationSequence(),
                dc.launch({ program: PROGRAM, stopOnEntry: true }),
                dc.assertStoppedLocation('entry', { path: PROGRAM, line: ENTRY_LINE } )
            ]);
        });

        test('should stop on debugger statement', () => {
            const PROGRAM = path.join(DATA_ROOT, 'programWithDebugger.js');
            const DEBUGGER_LINE = 6;

            return Promise.all([
                dc.configurationSequence(),
                dc.launch({ program: PROGRAM }),
                dc.assertStoppedLocation('debugger statement', { path: PROGRAM, line: DEBUGGER_LINE } )
            ]);
        });

    });


    // verbose logging...
    suite.skip('output events', () => {
        const PROGRAM = path.join(DATA_ROOT, 'programWithOutput.js');

        test('stdout and stderr events should be complete and in correct order', () => {
            return Promise.all([
                dc.configurationSequence(),
                dc.launch({ program: PROGRAM }),
                dc.assertOutput('stdout', 'Hello stdout 0\nHello stdout 1\nHello stdout 2\n'),
                // dc.assertOutput('stderr', 'Hello stderr 0\nHello stderr 1\nHello stderr 2\n') // "debugger listening on port # ..." message
            ]);
        });
    });

    suite('eval', () => {
        const PROGRAM = path.join(DATA_ROOT, 'programWithFunction.js');
        function start(): Promise<void> {
            return Promise.all([
                dc.configurationSequence(),
                dc.launch({ program:  PROGRAM }),
                dc.waitForEvent('initialized')
            ]).then(() => { });
        }

        test('works for a simple case', () => {
            return start()
                .then(() => dc.evaluateRequest({ expression: '1 + 1' }))
                .then(response => {
                        assert(response.success);
                        assert.equal(response.body.result, '2');
                        assert.equal(response.body.variablesReference, 0);
                });
        });

        test('evaluates a global node thing', () => {
            return start()
                .then(() => dc.evaluateRequest({ expression: 'Object' }))
                .then(response => {
                    assert(response.success);
                    assert.equal(response.body.result, 'function Object() { … }');
                    assert(response.body.variablesReference > 0);
                });
        });

        test('returns "not available" for a reference error', () => {
            return start()
                .then(() => dc.evaluateRequest({ expression: 'notDefinedThing' }))
                .catch(response => {
                    assert.equal(response.message, 'not available');
                });
        });

        test('returns the error message for another error', () => {
            return start()
                .then(() => dc.evaluateRequest({ expression: 'throw new Error("fail")' }))
                .catch(response => {
                    assert.equal(response.message, 'Error: fail');
                });
        });

        test('Shows object previews', () => {
            return start()
                .then(() => dc.evaluateRequest({ expression: 'x = {a: 1, b: [1], c: {a: 1}}' }))
                .then(response => {
                    assert(response.success);
                    assert.equal(response.body.result, 'Object {a: 1, b: Array[1], c: Object}');
                    assert(response.body.variablesReference > 0);
                });
        });

        test('Shows array previews', () => {
            return start()
                .then(() => dc.evaluateRequest({ expression: '[1, [1], {a: 3}]' }))
                .then(response => {
                    assert(response.success);
                    assert.equal(response.body.result, 'Array[3] [1, Array[1], Object]');
                    assert(response.body.variablesReference > 0);
                });
        });
    });

    suite('completions', () => {
        const PROGRAM = path.join(DATA_ROOT, 'programWithVariables.js');

        function start(): Promise<void> {
            return Promise.all([
                dc.configurationSequence(),
                dc.launch({ program:  PROGRAM }),
                dc.waitForEvent('initialized'),
                dc.waitForEvent('stopped')
            ]).then(() => { });
        }

        function testCompletions(text: string, column = text.length + 1, frameIdx = 0): Promise<DebugProtocol.CompletionItem[]> {
            return start()
                .then(() => dc.stackTraceRequest())
                .then(stackTraceResponse => stackTraceResponse.body.stackFrames.map(frame => frame.id))
                .then(frameIds => dc.send('completions', <DebugProtocol.CompletionsArguments>{ text, column, frameId: frameIds[frameIdx] }))
                .then((response: DebugProtocol.CompletionsResponse) => response.body.targets);
        }

        function inCompletionsList(completions: DebugProtocol.CompletionItem[], ...labels: string[]): boolean {
            return labels.every(label => completions.filter(target => target.label === label).length === 1);
        }

        test('returns global vars', () => {
            return testCompletions('')
                .then(completions => assert(inCompletionsList(completions, 'global')));
        });

        test('returns local vars', () => {
            return testCompletions('')
                .then(completions => assert(inCompletionsList(completions, 'num', 'str', 'arr', 'obj')));
        });

        test('returns methods', () => {
            return testCompletions('arr.')
                .then(completions => assert(inCompletionsList(completions, 'push', 'indexOf')));
        });

        test('returns object properties', () => {
            return testCompletions('obj.')
                .then(completions => assert(inCompletionsList(completions, 'a', 'b')));
        });

        test('multiple dots', () => {
            return testCompletions('obj.b.')
                .then(completions => assert(inCompletionsList(completions, 'startsWith', 'endsWith')));
        });

        test('returns from the correct column', () => {
            return testCompletions('obj.b.', /*column=*/6)
                .then(completions => assert(inCompletionsList(completions, 'a', 'b')));
        });

        test('returns from the correct frameId', () => {
            return testCompletions('obj', undefined, /*frameId=*/1)
                .then(completions => assert(!inCompletionsList(completions, 'obj')));
        });

        test('returns properties of string literals', () => {
            return testCompletions('"".')
                .then(completions => assert(inCompletionsList(completions, 'startsWith')));
        });
    });

    suite('hit condition bps', () => {
        function continueAndStop(line: number): Promise<any> {
            return dc.continueTo('breakpoint', { path: PROGRAM, line });
        }

        const PROGRAM = path.join(DATA_ROOT, 'programWithFunction.js');
        test('Works for =', () => {
            const noCondBpLine = 15;
            const condBpLine = 14;
            const bps: DebugProtocol.SourceBreakpoint[] = [
                    { line: condBpLine, hitCondition: '=2' },
                    { line: noCondBpLine }];

            return Promise.all([
                testUtils.setBreakpointOnStart(dc, bps, PROGRAM),

                dc.launch({ program: PROGRAM }),

                // Assert that it skips
                dc.assertStoppedLocation('breakpoint', { path: PROGRAM, line: noCondBpLine })
                    .then(() => continueAndStop(condBpLine))
                    .then(() => continueAndStop(noCondBpLine))
                    .then(() => continueAndStop(noCondBpLine))
            ]);
        });

        test('Works for %', () => {
            const noCondBpLine = 15;
            const condBpLine = 14;
            const bps: DebugProtocol.SourceBreakpoint[] = [
                    { line: condBpLine, hitCondition: '%3' },
                    { line: noCondBpLine }];

            return Promise.all([
                testUtils.setBreakpointOnStart(dc, bps, PROGRAM),

                dc.launch({ program: PROGRAM }),

                // Assert that it skips
                dc.assertStoppedLocation('breakpoint', { path: PROGRAM, line: noCondBpLine })
                    .then(() => continueAndStop(noCondBpLine))
                    .then(() => continueAndStop(condBpLine))
                    .then(() => continueAndStop(noCondBpLine))
            ]);
        });

        test('Does not bind when invalid', () => {
            const condBpLine = 14;
            const bps: DebugProtocol.SourceBreakpoint[] = [
                    { line: condBpLine, hitCondition: 'lsdf' }];

            return Promise.all([
                testUtils.setBreakpointOnStart(dc, bps, PROGRAM, undefined, undefined, /*expVerified=*/false),
                dc.launch({ program: PROGRAM })
            ]);
        });
    });
});
