// change api
hiveTx.config.node = 'https://anyx.io'
let wakeLock = null;

async function init()  {
    // create an async function to request a wake lock
    try {
        wakeLock = await navigator.wakeLock.request("screen");
        console.log( "Wake Lock is active!");
    } catch (err) {
        // The Wake Lock request has failed - usually system related, such as battery.
        console.log( `${err.name}, ${err.message}`);
    }
}

function add() {
    localStorage.setItem
}
 
let myKey;
function setKey() { 
     myKey = prompt("What is your key?")
}
function voteOnPost(permLink, destinationAuthor, voter) {
    const operations = [
        [
            'vote',
            {
            voter: voter,
            author: destinationAuthor,
            permlink: permLink,
            weight: 9900
            }
        ]
    ]

    let privateKey;
    try {
        privateKey = hiveTx.PrivateKey.from(myKey)
    } catch (error) {
        alert("Invalid posting key");
        return;
    }
    
    const tx = new hiveTx.Transaction()
    
    // create transaction
    tx.create(operations).then(() => {
    //console.log('Created transaction:', tx.transaction)
    
    // sign the transaction
    tx.sign(privateKey)
    //console.log('Signed transaction:', tx.signedTransaction)
    
    // broadcast the transaction
    tx.broadcast().then(
        res => {if(res.error) {
            alert("error " + res.error.message)
        }}, 
        err=> alert('rejected ' + Object.values(err)))
    })
}

//get accounts
hiveTx
    .call('condenser_api.get_reward_fund', ["post"])
    .then(rewardFundsResponse => {
        let rewardFunds = rewardFundsResponse.result;
        hiveTx
            .call('condenser_api.get_accounts', [['grzegorz2047']])
            .then(accountResponse => {
                let accounts = accountResponse.result;
                const queriedAccount = accounts[0];
            });
    })

