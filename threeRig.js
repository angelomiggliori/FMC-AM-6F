const scene=new THREE.Scene()

const camera=new THREE.PerspectiveCamera(
70,
window.innerWidth/window.innerHeight,
0.1,
1000
)

const renderer=new THREE.WebGLRenderer({antialias:true})

renderer.setSize(window.innerWidth,window.innerHeight)

document.body.appendChild(renderer.domElement)

const light=new THREE.PointLight(0xffffff,1)

light.position.set(10,10,10)

scene.add(light)

const geo=new THREE.BoxGeometry(10,1,5)

const mat=new THREE.MeshStandardMaterial({

color:0x111111,
metalness:0.9,
roughness:0.25

})

const board=new THREE.Mesh(geo,mat)

scene.add(board)

camera.position.z=9
camera.position.y=4
camera.rotation.x=-0.4

function animate(){

requestAnimationFrame(animate)

board.rotation.y+=0.001

renderer.render(scene,camera)

}

animate()