import {CallAgain} from './index';

const sleep = (ms: number) => new Promise(resolve => setTimeout(() => resolve(ms), ms * 100));

describe("Wrapper functions", () => {
    test("calls wrapped function when needed", async () => {
        const c = new CallAgain();

        const func = jest.fn();

        const wrapperFunc = c.wrap(func);

        expect(func.mock.calls.length).toBe(0);
        await wrapperFunc();
        expect(func.mock.calls.length).toBe(1);
    });

    test("passes the same arguments", async () => {
        const c = new CallAgain();

        const func = jest.fn();

        const expectedArgument = 'the-argument';

        const wrapperFunc = c.wrap(func);

        await wrapperFunc(expectedArgument);

        expect(func.mock.calls[0][0]).toBe(expectedArgument);
    });

    test("returns the same result", async () => {
        const c = new CallAgain();

        const func = jest.fn();

        const expectedReturnValue = 'the-return-value';
        func.mockReturnValueOnce(expectedReturnValue);

        const wrapperFunc = c.wrap(func);
        const actualReturnValue = await wrapperFunc();

        expect(actualReturnValue).toBe(expectedReturnValue);
    });
});

describe("rejectAll works", () => {
    test("cancels current", async () => {
        const c = new CallAgain({
            maxConcurrentCalls: 2
        });

        const f1 = jest.fn(() => sleep(1));
        const f2 = jest.fn(() => sleep(3));

        const h1 = c.wrap(f1);
        const h2 = c.wrap(f2);

        expect(h1()).resolves.toBe(1);
        expect(h2()).rejects.toBe(undefined);

        await sleep(2);

        expect(f1.mock.calls.length).toBe(1);
        expect(f2.mock.calls.length).toBe(1);

        c.rejectAll();
    });

    test("cancels waiting", async () => {
        const c = new CallAgain({
            maxConcurrentCalls: 1
        });

        const f1 = jest.fn(() => sleep(2));
        const f2 = jest.fn(() => sleep(2));

        const h1 = c.wrap(f1);
        const h2 = c.wrap(f2);

        expect(h1()).rejects.toBe(undefined);
        expect(h2()).rejects.toBe(undefined);

        await sleep(1);

        expect(f1.mock.calls.length).toBe(1);
        expect(f2.mock.calls.length).toBe(0);

        c.rejectAll();
    });

    test("allows subsequent calls", async () => {
        const c = new CallAgain({
            maxConcurrentCalls: 1
        });

        const f1 = jest.fn(() => sleep(2));
        const f2 = jest.fn(() => sleep(2));

        const h1 = c.wrap(f1);
        const h2 = c.wrap(f2);

        expect(h1()).rejects.toBe(undefined);

        await sleep(1);

        expect(h2()).resolves.toBe(2);
    });
});



