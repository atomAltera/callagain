export type ResolveFunc<T> = (value: T) => void;
export type RejectFunc = (reason?: any) => void;
export type AgainFunc = (sleep?: number) => void;
export type QueueFunc<T> = (resolve: ResolveFunc<T>, reject: RejectFunc, again: AgainFunc) => void;

interface QueueEntry<T> {
    func: QueueFunc<T>
    resolve: ResolveFunc<T>
    reject: RejectFunc
}

interface CallAgainOptions {
    defaultCycleDelay?: number
    defaultRetryDelay?: number;
}

const DEFAULT_OPTIONS = {
    defaultCycleDelay: 0,
    defaultRetryDelay: 1000,
};

export default class CallAgain {
    private _queue: QueueEntry<any>[] = [];

    private _cycleTimer?: number;
    private _delayTimer?: number;
    private _aborted = false;

    private readonly _options: CallAgainOptions;

    /**
     * Create instance of CallAgain
     * @param {CallAgainOptions} options - configuration options
     */
    constructor(options?: CallAgainOptions) {
        this._options = {
            ...DEFAULT_OPTIONS,
            ...options
        };

        this._planNextCycle = this._planNextCycle.bind(this);
        this._cycle = this._cycle.bind(this);
    }

    /**
     * Adds function to executions queue
     * @param {function} func - function to execute
     * @return {Promise} promise of *func* return value
     */
    public add<T>(func: QueueFunc<T>): Promise<T> {
        this._aborted = false;

        return new Promise<T>((resolve, reject) => {
            this._queue.unshift({func, resolve, reject});

            this._planNextCycle();
        });
    }

    /**
     * Clears execution queue, cancels all calls
     */
    public reset(): void {
        this._aborted = true;

        this._delayTimer && clearTimeout(this._delayTimer);
        this._cycleTimer && clearTimeout(this._cycleTimer);

        this._queue = [];
    }


    private _processEntry<T>(entry: QueueEntry<T>): Promise<void> {
        return new Promise<void>((finish) => {

            const retry = (delay?: number) => {
                delay = delay || this._options.defaultRetryDelay;

                this._delayTimer = setTimeout(() => {
                    this._delayTimer = undefined;
                    this._processEntry(entry).then(finish)
                }, delay)
            };

            entry.func(
                (v: T) => {
                    finish();
                    this._aborted || entry.resolve(v);
                },
                (r?: any) => {
                    finish();
                    this._aborted || entry.reject(r);
                },
                retry
            );

        });
    }

    private _planNextCycle() {
        if (this._aborted) {
            return;
        }

        if (this._cycleTimer !== undefined) {
            return;
        }

        this._cycleTimer = setTimeout(this._cycle, this._options.defaultCycleDelay)
    }

    private _cycle() {
        this._cycleTimer = undefined;
        const entry = this._queue.pop();

        if (entry === undefined) {
            return
        }

        this._processEntry(entry).then(this._planNextCycle)
    }
}