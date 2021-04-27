let webData = JSON.parse(websiteDataJson);

function loadTextsFromFile() {
    Object.keys(webData).forEach(function(key,index) {
        $("#"+ key).text(webData[key]);
    });
}

$(function() {
    loadTextsFromFile();
});
