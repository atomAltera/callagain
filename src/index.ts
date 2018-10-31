import Loki from 'lokijs';

export interface CallAgainOptions {
    maxConcurrentCalls?: number
    maxRetryAttempts?: number
    delayOnRetry?: number
    maxCallsPerInterval?: number
    intervalLength?: number
}

export type NextHandler = (err: any) => boolean;
export type ErrorHandler = (err: any, next: NextHandler) => boolean;

type Args<F> = F extends (...args: infer T) => any ? T : never
type Return<F> = F extends (...args: any[]) => infer T ? T : never
type Promised<T> = T extends PromiseLike<any> ? T : Promise<T>

enum CallEntryStatus {
    init, waiting, processing, done
}

interface CallEntry {
    id: number

    func: Function
    args: any

    resolve?: (value: any) => void
    reject?: (reason?: any) => void

    status: CallEntryStatus

    attempts: number
    delay: number
}

interface CallHistory {
    entryId: number
    timestamp: number
}

export class CallAgain {
    private readonly _maxConcurrentCalls?: number;
    private readonly _maxRetryAttempts: number;
    private readonly _delayOnRetry: number;
    private readonly _maxCallsPerInterval?: number;
    private readonly _intervalLength?: number;

    private _cycleTimer?: number = undefined;

    private readonly _db: Loki;
    private readonly _entries: Loki.Collection<CallEntry>;
    private readonly _history: Loki.Collection<CallHistory>;

    private _errorHandlers: ErrorHandler[] = [];
    private _lastId = 0;

    public constructor(options?: CallAgainOptions) {
        this._maxConcurrentCalls = options && options.maxConcurrentCalls;
        this._maxRetryAttempts = options && options.maxRetryAttempts || 10;
        this._delayOnRetry = options && options.delayOnRetry || 1000;
        this._maxCallsPerInterval = options && options.maxCallsPerInterval;
        this._intervalLength = options && options.intervalLength;

        this._db = new Loki('callagain.json');
        this._entries = this._db.addCollection('entries', {unique: ['id',], indices: ['status',]});
        this._history = this._db.addCollection('history', {indices: ['timestamp',]});

        this._planNextCycle = this._planNextCycle.bind(this);
        this._onCycleTimerTick = this._onCycleTimerTick.bind(this);

        // Default error handler
        this._errorHandlers.push(() => true);
    }

    /**
     * Creates new function from provided. New function is controlled by CallAgain
     * @param {Function} f - function that needs to be controlled
     * @return {Function} controlled function
     */
    public wrap<F extends Function>(f: F) {
        return (
            (...args: any) => {
                return this._onWrapperCalled(f, args)
            }
        ) as (...args: Args<F>) => Promised<Return<F>>
    }

    /**
     * Registers error handler
     * @param handler
     */
    public onError(handler: ErrorHandler): this {
        this._errorHandlers.unshift(handler);
        return this;
    }

    /**
     * Set timeout to call cycle method next time
     * @private
     */
    private _planNextCycle() {
        if (this._cycleTimer !== undefined) return; // next cycle already planned

        const timeout = this._calculateNextCycleDelay();
        if (timeout === undefined) return; // nothing to process

        this._cycleTimer = setTimeout(this._onCycleTimerTick, timeout);
    }

    private _calculateNextCycleDelay() {
        const initEntriesCount = this._entries.count({status: CallEntryStatus.init});
        const waitingEntriesCount = this._entries.count({status: CallEntryStatus.waiting});

        // nothing to process
        if ((initEntriesCount === 0) && (waitingEntriesCount === 0)) return undefined;

        // there is entries still in initialization process
        if (waitingEntriesCount === 0) return 1;

        // interval limit exceeded
        if (this._calculateCallsLeftBeforeIntervalLimit() === 0) return this._intervalLength;

        // concurrent limit exceeded
        if (this._calculateCallsLeftBeforeConcurrentLimit() === 0) return undefined;

        const now = Date.now();

        // there is entries that need to be executed ASP
        const plannedForNowCount = this._entries.count({status: CallEntryStatus.waiting, delay: {$lte: now}});
        if (plannedForNowCount > 0) return 0;

        // calculate time to closest by delay
        const closestByDelay = this._entries.chain()
            .find({status: CallEntryStatus.waiting})
            .simplesort('delay')
            .limit(1)
            .data()[0]!;

        const delay = closestByDelay.delay - now;

        if (delay < 0) {
            console.warn("delay < 0 in _calculateNextCycleDelay");
            return 0;
        }

        return delay;
    }

    private _calculateCallsLeftBeforeConcurrentLimit() {
        if (this._maxConcurrentCalls === undefined) return undefined;

        const currentCalls = this._entries.count({status: CallEntryStatus.processing});

        const callsLeft = this._maxConcurrentCalls - currentCalls;

        if (callsLeft < 0) {
            console.warn("callsLeft < 0 in _calculateCallsLeftBeforeConcurrentLimit");
            return 0;
        }

        return callsLeft;
    }

    private _calculateCallsLeftBeforeIntervalLimit() {
        if (this._maxCallsPerInterval === undefined) return undefined;
        if (this._intervalLength === undefined) return undefined;

        const intervalStartTime = Date.now() - this._intervalLength;

        const callsMade = this._history.count({timestamp: {$gte: intervalStartTime}});

        const callsLeft = this._maxCallsPerInterval - callsMade;

        if (callsLeft < 0) {
            console.warn("callsLeft < 0 in _calculateCallsLeftBeforeIntervalLimit");
            return 0;
        }

        return callsLeft;
    }

    private _onCycleTimerTick() {
        const waitingEntriesCount = this._entries.count({status: CallEntryStatus.waiting});

        if (waitingEntriesCount === 0) {
            this._cycleTimer = undefined;
            return
        }

        let callsLeftBeforeConcurrentLimit = this._calculateCallsLeftBeforeConcurrentLimit();
        let callsLeftBeforeIntervalLimit = this._calculateCallsLeftBeforeIntervalLimit();

        if (callsLeftBeforeConcurrentLimit === undefined) callsLeftBeforeConcurrentLimit = waitingEntriesCount;
        if (callsLeftBeforeIntervalLimit === undefined) callsLeftBeforeIntervalLimit = waitingEntriesCount;

        const maxCallsBeforeLimit = Math.min(callsLeftBeforeConcurrentLimit, callsLeftBeforeIntervalLimit);

        // Select entries calls
        const entriesToProcess = this._entries.chain()
            .find({
                status: CallEntryStatus.waiting,
                delay: {$lt: Date.now()}
            })
            .simplesort('id')
            .limit(maxCallsBeforeLimit)
            .data()
        ;

        // if nothing to do, just return
        if (entriesToProcess.length === 0) {
            this._cycleTimer = undefined;
            this._planNextCycle();
            return
        }

        // start processing
        for (let entry of entriesToProcess) {
            this._processEntry(entry);
        }

        // plan next cycle
        this._cycleTimer = undefined;
        this._planNextCycle();
    }

    private _processEntry(entry: CallEntry) {
        entry.status = CallEntryStatus.processing;

        // TODO: Extract somewhere
        // TODO: Clean up somewhere
        this._history.insert({entryId: entry.id, timestamp: Date.now()});

        // TODO: Clean up done entries
        Promise.resolve()
            .then(() => entry.func.apply(undefined, entry.args))
            .then(result => {
                entry.status = CallEntryStatus.done;
                entry.resolve!(result);
            })
            .catch(e => {
                entry.attempts = entry.attempts + 1;

                if ((this._maxRetryAttempts !== undefined) && (entry.attempts >= this._maxRetryAttempts)) {
                    entry.status = CallEntryStatus.done;
                    entry.reject!(e);
                    return
                }

                if (this._shouldRetryOnError(e)) {
                    entry.delay = Date.now() + this._delayOnRetry;
                    entry.status = CallEntryStatus.waiting;
                } else {
                    entry.status = CallEntryStatus.done;
                    entry.reject!(e);
                }
            })
            .then(() => this._entries.update(entry))
            .then(() => this._planNextCycle())
        ;
    }

    private _shouldRetryOnError(err: any): boolean {
        const getHandler = (index: number): NextHandler => {
            const handler = this._errorHandlers[index];

            return (err: any) => handler(err, getHandler(index + 1))
        };

        return getHandler(0)(err);
    }

    /**
     * Is called by wrapped function
     * @param {function} func - source function
     * @param args - arguments passed to wrapped function
     * @private
     */
    private _onWrapperCalled(func: Function, args: any) {
        const id = this._getNewId();

        this._entries.insert({
            id,

            func,
            args,

            resolve: undefined,
            reject: undefined,

            status: CallEntryStatus.init,

            attempts: 0,
            delay: 0,
        });

        this._planNextCycle();

        return new Promise((resolve, reject) => {
            this._entries.findAndUpdate({id}, e => {
                e.resolve = resolve;
                e.reject = reject;
                e.status = CallEntryStatus.waiting;
            });
        });
    }

    private _getNewId() {
        return ++this._lastId;
    }
}