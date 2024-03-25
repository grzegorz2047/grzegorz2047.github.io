async function readNFCData() {
    const ndef = new NDEFReader();
ndef
  .scan()
  .then(() => {
    console.log("Scan started successfully.");
    ndef.onreadingerror = (event) => {
      console.log(
        "Error! Cannot read data from the NFC tag. Try a different one?",
      );
    };
    ndef.onreading = (event) => {
      console.log("NDEF message read.");
      console.log(event)
    };
  })
  .catch((error) => {
    console.log(`Error! Scan failed to start: ${error}.`);
  });
}
async function writeNFCData() {
    const ndef = new NDEFReader();
    let ignoreRead = false;
    
    ndef.onreading = (event) => {
      if (ignoreRead) {
        return; // write pending, ignore read.
      }
    
      console.log("We read a tag, but not during pending write!");
    };
    
    
    await ndef.scan();
    try {
      await write("Hello World");
      console.log("We wrote to a tag!");
    } catch (err) {
      console.error("Something went wrong", err);
    }   
    
}
function write(data) {
    ignoreRead = true;
    return new Promise((resolve, reject) => {
      ndef.addEventListener(
        "reading",
        (event) => {
          // Check if we want to write to this tag, or reject.
          ndef
            .write(data)
            .then(resolve, reject)
            .finally(() => (ignoreRead = false));
        },
        { once: true },
      );
    });
  }