# CallAgain



This package help you to deal with function that:

- should be called again with same arguments in case of some specific errors;
- should not be called more than N time in some time unit;
- should not be called simultaneously more then N times;



## Installing


```
$ npm install callagain
```



## Basic usage example

```javascript
// Here is function, it makes direct call to some API
const {loadItemsFromRemoteServer} = requires('./lib');

// Import helper
const {CallAgain} = require('callagain');

// Create instance
const c = new CallAgain({
    // Concurrency settings
    maxConcurrentCalls: 10, // Extrernal API allows only 10 concurrent calls

    // Retry on error settings
    maxRetryAttempts: 5, // Try 5 time before throw error
    delayOnRetry: 5000, // If some call fails, wait 5 sec and try again
    
    // Rate limit settings
    maxCallsPerInterval: 50, // External API allows 50 calls per minute
    intervalLength: 60000 // External API allows 50 calls per minute
});

// Use helper's *wrap* method to create safe version of needed function
const safeLoadItems = c.wrap(loadItemsFromRemoteServer);

// Now we can simply call our function
for (int page=0; page<100; page++) {
    safeLoadItems(page)
        .then(items => {
    		// ...    
	    })
    	.catch(e => console.error(e.message))
}

```


## Error handling

You can specify error handlers

```javascript
const c = new CallAgain({...});

// wrapping axios get call
const getItems = c.wrap(url => axios.get);


c.onError((err, next) => {
    // here err is axios error
    
    // this function must return boolean value
    // indicating should CallAgain retry or not
    
    
    if (err.response.status >= 500) {
            // Unknown server error, retry in *delayOnRetry* milliseconds
            return true
    }  
        
    
    // if you do not know, how to deal with error, you should pass it to next handler
    return next(err)
});

//handlers han be chained
c.onError(...).onError(...).onError(...)
```


## Rejecting all

You can reject all pending calls by calling `rejectAll` method

```javascript
const c = new CallAgain({...});

c.wrap(() => new Promise(resolve => setTimeout(resolve, 1000)))().catch(e => {
    console.log(e) // "Reject reason"
});


setTimeout(() => {
   c.rejectAll("Reject reason") // optional value to pass to catch handler 
}, 500)

```