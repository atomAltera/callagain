import {CallAgain} from './index';

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



