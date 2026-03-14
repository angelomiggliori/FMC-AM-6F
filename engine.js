const banks=["A","B","C","D","E","F","G","H","I","J"]

let bank=0
let patch=0

let preselect=false
let preBank=0

const display=document.getElementById("display")
const mode=document.getElementById("mode")

function update(){

display.innerText=banks[bank]+patch

}

function sendMidi(){

let pc=(bank*10)+patch

sendPC(pc)

}

function selectPatch(p){

if(preselect){

bank=preBank
patch=p

preselect=false
mode.innerText="CONFIRM"

}else{

patch=p

}

update()
sendMidi()

}

function nextBank(){

if(!preselect)return

preBank++

if(preBank>9)preBank=0

display.innerText=banks[preBank]+"?"

}

function holdBank(){

preselect=true
preBank=bank

mode.innerText="BANK SELECT"

}

fs1.onclick=()=>selectPatch(0)
fs2.onclick=()=>selectPatch(1)
fs3.onclick=()=>selectPatch(2)
fs4.onclick=()=>selectPatch(3)
fs5.onclick=()=>selectPatch(4)

fs6.onclick=nextBank
fs6.oncontextmenu=holdBank

update()