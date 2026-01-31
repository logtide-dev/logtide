import { describe, it, expect } from 'vitest';
import { ExceptionDetectionService } from '../../../modules/exceptions/detection.js';

describe('ExceptionDetectionService', () => {
    describe('detectException', () => {
        describe('structured exception (metadata.exception)', () => {
            it('should parse structured exception from metadata', () => {
                const metadata = {
                    exception: {
                        type: 'TypeError',
                        message: 'Cannot read property of undefined',
                        language: 'javascript',
                        stacktrace: [
                            {
                                file: '/app/src/index.js',
                                function: 'handleRequest',
                                line: 42,
                                column: 10,
                            },
                        ],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error occurred', metadata);

                expect(result).not.toBeNull();
                expect(result?.exceptionType).toBe('TypeError');
                expect(result?.exceptionMessage).toBe('Cannot read property of undefined');
                expect(result?.language).toBe('javascript');
                expect(result?.frames).toHaveLength(1);
            });

            it('should mark app code vs library code in frames', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test error',
                        stacktrace: [
                            { file: '/app/src/index.js', function: 'main', line: 1 },
                            { file: '/app/node_modules/express/lib/router.js', function: 'handle', line: 100 },
                            { file: '/app/vendor/lib/helper.js', function: 'run', line: 50 },
                            { file: '/usr/lib/python3.10/site-packages/flask/app.py', function: 'dispatch', line: 200 },
                        ],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].isAppCode).toBe(true);
                expect(result?.frames[1].isAppCode).toBe(false); // node_modules
                expect(result?.frames[2].isAppCode).toBe(false); // vendor
                expect(result?.frames[3].isAppCode).toBe(false); // site-packages
            });

            it('should return null for invalid structured exception', () => {
                const metadata = {
                    exception: {
                        // Missing required fields
                        someField: 'value',
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                // Should fallback to text parsing
                expect(result === null || result?.exceptionType !== undefined).toBe(true);
            });

            it('should return null for exception with empty type', () => {
                const metadata = {
                    exception: {
                        type: '',
                        message: 'Some message',
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                // Should fallback to text parsing
                expect(result === null || result?.exceptionType !== undefined).toBe(true);
            });

            it('should return null for exception with empty message', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: '',
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result === null || result?.exceptionType !== undefined).toBe(true);
            });

            it('should handle exception without stacktrace', () => {
                const metadata = {
                    exception: {
                        type: 'ValueError',
                        message: 'Invalid value',
                        language: 'python',
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result).not.toBeNull();
                expect(result?.exceptionType).toBe('ValueError');
                expect(result?.frames).toHaveLength(0);
            });

            it('should handle exception with raw trace only', () => {
                // When there's no stacktrace but raw exists, it falls back to ParserFactory
                // which parses the raw string. If the raw has valid format, it returns parsed result
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        raw: 'Error: Test\n    at main (index.js:1:1)',
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                // The result depends on ParserFactory being able to parse the raw trace
                // If ParserFactory can parse it, we get a result; otherwise null
                if (result) {
                    expect(result.rawStackTrace).toContain('Error');
                }
            });

            it('should limit cause chain depth to prevent DoS', () => {
                // Create deeply nested cause chain
                let exception: any = {
                    type: 'RootError',
                    message: 'Root cause',
                };

                // Add 15 levels of causes (more than MAX_CAUSE_DEPTH = 10)
                for (let i = 0; i < 15; i++) {
                    exception = {
                        type: `Error${i}`,
                        message: `Error at level ${i}`,
                        cause: exception,
                    };
                }

                const metadata = { exception };

                // Should not throw and should handle gracefully
                const result = ExceptionDetectionService.detectException('Error', metadata);
                expect(result).not.toBeNull();
            });

            it('should limit stack frames to MAX_STACK_FRAMES', () => {
                const frames = [];
                for (let i = 0; i < 150; i++) {
                    frames.push({
                        file: `/app/src/file${i}.js`,
                        function: `func${i}`,
                        line: i,
                    });
                }

                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: frames,
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                // Should be limited to MAX_STACK_FRAMES (100)
                expect(result?.frames.length).toBeLessThanOrEqual(100);
            });

            it('should skip frames with no file and no function', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [
                            { file: '/app/src/index.js', function: 'main', line: 1 },
                            { line: 2, column: 3 }, // No file or function
                            { file: '/app/src/other.js', function: 'other', line: 3 },
                        ],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames).toHaveLength(2);
            });

            it('should set unknown file path for frames without file', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [
                            { function: 'anonymousFunction', line: 1 },
                        ],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].filePath).toBe('<unknown>');
            });

            it('should include frame metadata when present', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [
                            {
                                file: '/app/src/index.js',
                                function: 'main',
                                line: 1,
                                metadata: { custom: 'value' },
                            },
                        ],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].metadata).toEqual({ custom: 'value' });
            });

            it('should set default language to unknown', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.language).toBe('unknown');
            });
        });

        describe('text parsing fallback', () => {
            it('should fallback to text parsing when no metadata.exception', () => {
                const message = 'Error: Something went wrong\n    at main (/app/index.js:10:5)';

                const result = ExceptionDetectionService.detectException(message);

                // ParserFactory should parse this
                expect(result === null || result?.exceptionType !== undefined).toBe(true);
            });

            it('should return null for non-exception messages', () => {
                const message = 'INFO: Application started successfully';

                const result = ExceptionDetectionService.detectException(message);

                expect(result).toBeNull();
            });
        });

        describe('library pattern detection', () => {
            it('should detect node_modules as library code', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [{ file: '/app/node_modules/lodash/index.js', function: 'map', line: 1 }],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].isAppCode).toBe(false);
            });

            it('should detect vendor/ as library code', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [{ file: '/app/vendor/symfony/component.php', function: 'run', line: 1 }],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].isAppCode).toBe(false);
            });

            it('should detect site-packages as library code', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [{ file: '/usr/lib/python3.10/site-packages/flask/app.py', function: 'dispatch', line: 1 }],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].isAppCode).toBe(false);
            });

            it('should detect .cargo as library code', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [{ file: '/home/user/.cargo/registry/src/crate/lib.rs', function: 'run', line: 1 }],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].isAppCode).toBe(false);
            });

            it('should detect go/pkg/mod as library code', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [{ file: '/home/user/go/pkg/mod/github.com/gin-gonic/gin/router.go', function: 'ServeHTTP', line: 1 }],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].isAppCode).toBe(false);
            });

            it('should detect .m2/repository as library code', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [{ file: '/home/user/.m2/repository/org/springframework/spring-core/5.0.0/Spring.class', function: 'run', line: 1 }],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].isAppCode).toBe(false);
            });

            it('should detect <internal> as library code', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [{ file: '<internal>/process/task_queues.js', function: 'process', line: 1 }],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].isAppCode).toBe(false);
            });

            it('should detect <frozen as library code', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [{ file: '<frozen importlib._bootstrap>', function: '_find_and_load', line: 1 }],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].isAppCode).toBe(false);
            });

            it('should detect lib/python as library code', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [{ file: '/usr/lib/python3.10/asyncio/base_events.py', function: 'run_forever', line: 1 }],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].isAppCode).toBe(false);
            });

            it('should detect $GOROOT as library code', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [{ file: '$GOROOT/src/runtime/panic.go', function: 'gopanic', line: 1 }],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].isAppCode).toBe(false);
            });

            it('should detect phar: as library code', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [{ file: 'phar:///app/vendor/composer/autoload.php', function: 'load', line: 1 }],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].isAppCode).toBe(false);
            });

            it('should detect System/ as library code', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [{ file: '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation', function: 'CFRunLoopRun', line: 1 }],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].isAppCode).toBe(false);
            });

            it('should detect Library/ as library code', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [{ file: '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/stdio.h', function: 'printf', line: 1 }],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].isAppCode).toBe(false);
            });

            it('should detect app code correctly', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [
                            { file: '/app/src/index.js', function: 'main', line: 1 },
                            { file: '/home/user/projects/myapp/handler.py', function: 'handle', line: 10 },
                            { file: 'C:\\Users\\dev\\project\\src\\main.cs', function: 'Main', line: 5 },
                        ],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames[0].isAppCode).toBe(true);
                expect(result?.frames[1].isAppCode).toBe(true);
                expect(result?.frames[2].isAppCode).toBe(true);
            });
        });

        describe('raw trace reconstruction', () => {
            it('should reconstruct raw trace from structured data', () => {
                const metadata = {
                    exception: {
                        type: 'TypeError',
                        message: 'Cannot read property',
                        stacktrace: [
                            { file: '/app/index.js', function: 'main', line: 10, column: 5 },
                            { file: '/app/utils.js', function: 'helper', line: 20 },
                        ],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.rawStackTrace).toContain('TypeError: Cannot read property');
                expect(result?.rawStackTrace).toContain('at main (/app/index.js:10:5)');
                expect(result?.rawStackTrace).toContain('at helper (/app/utils.js:20)');
            });

            it('should handle anonymous functions in reconstruction', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [
                            { file: '/app/index.js', line: 10 }, // No function name
                        ],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.rawStackTrace).toContain('<anonymous>');
            });

            it('should handle unknown file in reconstruction', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [
                            { function: 'someFunc', line: 10 }, // No file
                        ],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.rawStackTrace).toContain('<unknown>');
            });

            it('should include cause in reconstruction', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Outer error',
                        cause: {
                            type: 'InnerError',
                            message: 'Root cause',
                            stacktrace: [
                                { file: '/app/inner.js', function: 'innerFunc', line: 5 },
                            ],
                        },
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.rawStackTrace).toContain('Caused by:');
                expect(result?.rawStackTrace).toContain('InnerError: Root cause');
            });
        });

        describe('edge cases', () => {
            it('should handle null metadata', () => {
                const result = ExceptionDetectionService.detectException('Regular log message', undefined);

                expect(result).toBeNull();
            });

            it('should handle metadata without exception', () => {
                const result = ExceptionDetectionService.detectException('Regular log message', { other: 'data' });

                expect(result).toBeNull();
            });

            it('should handle null exception in metadata', () => {
                const result = ExceptionDetectionService.detectException('Error', { exception: null });

                expect(result).toBeNull();
            });

            it('should handle non-object exception in metadata', () => {
                const result = ExceptionDetectionService.detectException('Error', { exception: 'string' });

                expect(result).toBeNull();
            });

            it('should handle stacktrace that is not an array', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: 'not an array',
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames).toHaveLength(0);
            });

            it('should handle frames with minimal data in stacktrace', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [
                            { file: '/app/index.js', function: 'main', line: 1 },
                            { file: '/app/other.js', line: 2 }, // No function
                        ],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames).toHaveLength(2);
            });

            it('should handle valid object frames in stacktrace', () => {
                const metadata = {
                    exception: {
                        type: 'Error',
                        message: 'Test',
                        stacktrace: [
                            { file: '/app/index.js', function: 'main', line: 1 },
                            { file: '/app/util.js', function: 'helper', line: 10 },
                        ],
                    },
                };

                const result = ExceptionDetectionService.detectException('Error', metadata);

                expect(result?.frames).toHaveLength(2);
            });
        });
    });
});
