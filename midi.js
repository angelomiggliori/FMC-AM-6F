let midiOut=null

async function initMIDI(){

try{

const access=await navigator.requestMIDIAccess()

for(let output of access.outputs.values()){

midiOut=output
console.log("MIDI conectado:",output.name)

}

}catch(e){

console.log("WebMIDI indisponível")

}

}

function sendPC(pc){

if(!midiOut)return

midiOut.send([0xC0,pc])

console.log("Program Change:",pc)

}

initMIDI()