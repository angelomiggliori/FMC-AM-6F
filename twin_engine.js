/* FMC-AM 6F DIGITAL TWIN ENGINE */

const BANKS=["A","B","C","D","E","F","G","H","I","J"]

class FMC_TWIN{

constructor(){

this.bank=0
this.patch=0

this.mode="EXEC"

this.bankPage=0
this.bankPre=0

this.tapTimes=[]

}

/* TAP TEMPO */

tap(){

let now=Date.now()

this.tapTimes.push(now)

if(this.tapTimes.length>4)
this.tapTimes.shift()

if(this.tapTimes.length<2)
return null

let diff=0

for(let i=1;i<this.tapTimes.length;i++)
diff+=this.tapTimes[i]-this.tapTimes[i-1]

diff/=this.tapTimes.length-1

let bpm=60000/diff

if(bpm<30)bpm=30
if(bpm>240)bpm=240

return bpm

}

/* FOOTSWITCH */

press(id){

/* banco */

if(this.mode==="BANK_SELECT"){

this.bankPre=id-1+this.bankPage*5

this.mode="BANK_CONFIRM"

return null

}

if(this.mode==="BANK_CONFIRM"){

this.bank=this.bankPre

this.patch=(id-1)*2

this.mode="EXEC"

return this.getProgram()

}

/* execução */

let base=(id-1)*2

if(this.patch===base)
this.patch=base+1
else
this.patch=base

return this.getProgram()

}

/* HOLD FS6 */

enterBankMode(){

this.mode="BANK_SELECT"
this.bankPage=0

}

toggleBankPage(){

this.bankPage=this.bankPage?0:1

}

getProgram(){

return this.bank*10+this.patch

}

getPatchLabel(){

return BANKS[this.bank]+this.patch

}

}