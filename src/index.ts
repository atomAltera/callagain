export interface RetryFunc {
    (sleep?: number): void
}

export interface QueueFunc<T> {
    (
        resolve: (value: T) => void,
        reject: (reason?: any) => void,
        retry: RetryFunc
    ): void
}

interface QueueEntry<T> {
    func: QueueFunc<T>;
    resolve: (arg: T | PromiseLike<T>) => void
    reject: (reason?: any) => void
}

export default class CallAgain {
    private _queue: QueueEntry<any>[] = [];

    private _cycleTimer?: number;
    private _sleepTimer?: number;
    private _aborted = false;

    constructor() {
        this._planNextCycle = this._planNextCycle.bind(this);
        this._cycle = this._cycle.bind(this);

    }

    public add<T>(func: QueueFunc<T>): Promise<T> {
        this._aborted = false;
        return new Promise<T>((resolve, reject) => {
            this._queue.unshift({func, resolve, reject});

            this._planNextCycle();
        });
    }

    public clear() {
        this._aborted = true;
        this._sleepTimer && clearTimeout(this._sleepTimer);
        this._cycleTimer && clearTimeout(this._cycleTimer);
        this._queue = [];
    }

    private _processEntry<T>(entry: QueueEntry<T>) {
        return new Promise((finish) => {
            const retry = (sleep?: number) => {
                sleep = sleep || 0;

                this._sleepTimer = setTimeout(() => {
                    this._sleepTimer = undefined;
                    this._processEntry(entry).then(finish)
                }, sleep)
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
        })
    }

    private _planNextCycle() {
        if (this._cycleTimer !== undefined) {
            return;
        }

        this._cycleTimer = setTimeout(this._cycle, 100)
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