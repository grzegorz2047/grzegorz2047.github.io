// change api
hiveTx.config.node = 'https://anyx.io'
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

function refreshList() {
    document.getElementById('gem-list').innerHTML = '';
    const minimumValueRatio = document.getElementById('gemRatio').value;
    const numberOfPostsToCheckInTrending = document.getElementById('postsToCheck').value;
    hiveTx
        .call('condenser_api.get_discussions_by_trending', [
            
            {
              "limit": numberOfPostsToCheckInTrending
            }
          ])
        .then(res => {
            console.log('Get articles:', res)
            res.result.forEach(article => {
                let pendingReward = article['pending_payout_value'].replace('HBD','').trim();
                let numberOfVotes = article['active_votes'].length
                let valueRatio = pendingReward / numberOfVotes;
                const isLittleGem = valueRatio > minimumValueRatio
                if (isLittleGem) {
                    let row = document.createElement("li");
                    let ratioBadge = document.createElement("span");
                    let link = document.createElement("a");
                    const url = 'https://peakd.com/' + '@' + article['author'] + '/' + article['permlink'];
                    row.classList = "list-group-item list-group-item-primary d-flex justify-content-between align-items-center";
                    ratioBadge.classList = "badge bg-primary rounded-pill";
                    ratioBadge.text = valueRatio;
                    link.text = url;
                    link.href = url;
                    link.target = "_blank";
                    row.appendChild(link);
                    row.appendChild(ratioBadge);
                    document.getElementById('gem-list').appendChild(row);

                }
            });
        })
}
// get accounts
// hiveTx
//     .call('condenser_api.get_accounts', [['grzegorz2047']])
//     .then(res => console.log('Get accounts:', res))
// get good trends articles
