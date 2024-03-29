import * as THREE from "./libs/three.module.js";
import * as CANNON from "./libs/cannon-es.js";
import { OrbitControls } from "./libs/OrbitControls.js";
import { VRButton } from "./webxr/VRButton.js";
import { XRControllerModelFactory } from "./webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "./webxr/XRHandModelFactory.js";
import cannonDebugger from "./libs/cannon-es-debugger.js";
import { pdb, elementNames, elementradii } from "./utils.js";

let container;
let camera, scene, renderer, world;
let hand1, hand2;
let controller1, controller2;
let controllerGrip1, controllerGrip2;
let myDebugger;

let chains = [];
let resids = [];
let restypes = [];
let atomNames = [];

const timestep = 1 / 60;

const atomRadius = 0.02;
const stickRadius = 0.007;
const scale = .04;
const translation = new THREE.Vector3(-0.6, 0.5, -2.3);

const tmpVector1 = new THREE.Vector3();
const tmpVector2 = new THREE.Vector3();
const tmpQuatertnion = new THREE.Quaternion();

const carbonMaterial = new THREE.MeshLambertMaterial({
  color: 0x555555,
});
const oxygenMaterial = new THREE.MeshLambertMaterial({
  color: 0xff0000,
});
const nitrogenMaterial = new THREE.MeshLambertMaterial({
  color: 0x0000ff,
});
const sulfurMaterial = new THREE.MeshLambertMaterial({
  color: 0xfdc12a,
});
const hydrogenMaterial = new THREE.MeshLambertMaterial({
  color: 0xfffffff,
});

const atomGeometry = new THREE.SphereBufferGeometry(5 * atomRadius, 16, 16);
const sphereShape = new CANNON.Sphere(1.5*atomRadius*1.3);

let controls;

let grabbing = false;

const atoms = [];
const atomBodies = [];
const bodies = [];
const meshes = [];
let grabbedMeshes = [];

init();
animate();

function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  world = new CANNON.World({
    gravity: new CANNON.Vec3(0, 0, 0), // m/s²
  });

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x444444);

  // myDebugger = cannonDebugger(scene, world.bodies, { autoUpdate: false });

  camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    10
  );
  camera.position.set(0, 1.6, 3);
  controls = new OrbitControls(camera, container);
  controls.target.set(0, 1.6, 0);
  controls.update();

  // Floor
  const floorGeometry = new THREE.PlaneGeometry(4, 4);
  const floorMaterial = new THREE.MeshLambertMaterial({ color: 0x156289 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const floorShape = new CANNON.Plane();
  const floorBody = new CANNON.Body({ mass: 0 });
  floorBody.quaternion.copy(floor.quaternion);
  floorBody.position.copy(floor.position);
  world.addBody(floorBody);
  bodies.push(floorBody);
  meshes.push(floor);
  floorBody.addShape(floorShape);

  // Lights
  const hemisphereLight = new THREE.HemisphereLight(0x808080, 0x606060);
  scene.add(hemisphereLight);

  const light = new THREE.DirectionalLight(0xffffff);
  light.position.set(0, 6, 0);
  light.castShadow = true;
  light.shadow.camera.top = 2;
  light.shadow.camera.bottom = -2;
  light.shadow.camera.right = 2;
  light.shadow.camera.left = -2;
  light.shadow.mapSize.set(1024, 1024);
  scene.add(light);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.xr.enabled = true;

  container.appendChild(renderer.domElement);
  document.body.appendChild(VRButton.createButton(renderer));

  // Controllers
  controller1 = renderer.xr.getController(0);
  scene.add(controller1);

  controller2 = renderer.xr.getController(1);
  scene.add(controller2);

  const controllerModelFactory = new XRControllerModelFactory();
  const handModelFactory = new XRHandModelFactory();

  // Hand1
  controllerGrip1 = renderer.xr.getControllerGrip(0);
  controllerGrip1.add(
    controllerModelFactory.createControllerModel(controllerGrip1)
  );
  scene.add(controllerGrip1);

  hand1 = renderer.xr.getHand(0);
  hand1.addEventListener("pinchstart", onPinchStart);
  hand1.addEventListener("pinchend", onPinchEnd);
  hand1.add(handModelFactory.createHandModel(hand1, "mesh"));
  scene.add(hand1);

  // Hand2
  controllerGrip2 = renderer.xr.getControllerGrip(1);
  controllerGrip2.add(
    controllerModelFactory.createControllerModel(controllerGrip2)
  );
  scene.add(controllerGrip2);

  hand2 = renderer.xr.getHand(1);
  hand2.addEventListener("pinchstart", onPinchStart);
  hand2.addEventListener("pinchend", onPinchEnd);
  hand2.add(handModelFactory.createHandModel(hand2, "mesh"));
  scene.add(hand2);

  buildMolecule(pdb);

  window.addEventListener("resize", onWindowResize);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render() {
  // myDebugger.update();
  renderer.render(scene, camera);
  world.step(timestep);
  updateMeshPositions();
}

function collideObject(indexTip) {
  for (let i = 0; i < atoms.length; i++) {
    const sphere = atoms[i];
    const distance = indexTip
      .getWorldPosition(tmpVector1)
      .distanceTo(sphere.getWorldPosition(tmpVector2));
    if (distance < sphere.geometry.boundingSphere.radius * sphere.scale.x*2) {
      return sphere;
    }
  }
  return null;
}

// This function creates a 3D cylinder from A to B
function cylindricalSegment(A, B, radius, material) {
  var vec = B.clone();
  vec.sub(A);
  var h = vec.length();
  vec.normalize();
  var quaternion = new THREE.Quaternion();
  quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vec);
  var geometry = new THREE.CylinderBufferGeometry(radius, radius, h, 16);
  geometry.translate(0, h / 2, 0);
  var cylinder = new THREE.Mesh(geometry, material);
  cylinder.applyQuaternion(quaternion);
  cylinder.position.set(A.x, A.y, A.z);
  return cylinder;
}

// This function returns 1.2 * (A + B)^2
// A and B are element radius
function radiiSum(elementA, elementB) {
  return 1.2 * Math.pow(elementA + elementB, 2);
}

function getBonds(atoms, indexes) {
  let bonds = {};

  for (let i = 0; i < atoms.length; i++) {
    const currentAtomI = `atom${i + 1}`;

    let distsqr;
    let bondedAtoms = [];

    for (let j = i + 1; j < atoms.length; j++) {
      const currentAtomJ = `atom${j + 1}`;

      tmpVector1.copy(atoms[i].position);
      tmpVector1.sub(translation);
      tmpVector1.multiplyScalar(1/scale);

      tmpVector2.copy(atoms[j].position);
      tmpVector2.sub(translation);
      tmpVector2.multiplyScalar(1/scale);

      //get distance squared
      distsqr =
        Math.pow(tmpVector1.x - tmpVector2.x, 2) +
        Math.pow(tmpVector1.y - tmpVector2.y, 2) +
        Math.pow(tmpVector1.z - tmpVector2.z, 2);

      //if distance squared is less than 1.2 x the sum of the radii squared, add a bond
      const radSum = radiiSum(elementradii[indexes[i]], elementradii[indexes[j]]);
      if (distsqr < radSum) {
        bondedAtoms.push(currentAtomJ);
      }
    }
    bonds[currentAtomI] = bondedAtoms;
  }
  return bonds;
}

function onPinchEnd(event) {
  const controller = event.target;
  if (controller.userData.selected !== undefined) {
    const object = controller.userData.selected;
    object.material.emissive.b = 0;
    scene.attach(object);
    controller.userData.selected = undefined;
    const index = grabbedMeshes.indexOf(object);
    grabbedMeshes.splice(index, 1);
    grabbing = false;
  }
}

function onPinchStart(event) {
  const controller = event.target;
  const indexTip = controller.joints["index-finger-tip"];
  const object = collideObject(indexTip);
  if (object) {
    grabbing = true;
    indexTip.attach(object);
    controller.userData.selected = object;
    grabbedMeshes.push(object);
    console.log("Selected", object);
  }
}

function updateMeshPositions() {
  for (let i = 0; i !== meshes.length; i++) {
    bodies[i].velocity.x = bodies[i].velocity.x / 1.01;
    bodies[i].velocity.y = bodies[i].velocity.y / 1.01;
    bodies[i].velocity.z = bodies[i].velocity.z / 1.01;

    const thisMeshId = meshes[i].id;
    const isGrabbed  = grabbedMeshes.some((grabbedMesh) => {
      return thisMeshId === grabbedMesh.id;
    })

    if (isGrabbed) {
      console.log("hey")
      meshes[i].getWorldPosition(tmpVector1);
      meshes[i].getWorldQuaternion(tmpQuatertnion);
      bodies[i].position.copy(tmpVector1);
      bodies[i].quaternion.copy(tmpQuatertnion);
    } else {
      meshes[i].position.copy(bodies[i].position);
      meshes[i].quaternion.copy(bodies[i].quaternion);
    }
  }
}

function buildMolecule(pdb) {
  const mass = 1;
  const lineas = pdb.split("\n");

  for (let i = 0; i < lineas.length; i++) {
    if (lineas[i].substring(0, 4) == "ATOM") {
      if (lineas[i].substring(13, 15).trim() == "CA") {
        resids.push(parseInt(lineas[i].substring(23, 26)));
        restypes.push(lineas[i].substring(17, 20).trim());
        atomNames.push(lineas[i].substring(13, 15).trim());

        const atom = new THREE.Mesh(atomGeometry, carbonMaterial);

        atom.position.set(
          parseFloat(lineas[i].substring(30, 38)),
          parseFloat(lineas[i].substring(38, 46)),
          parseFloat(lineas[i].substring(46, 54))
        );
        atom.position.multiplyScalar(scale);
        atom.position.add(translation);
        atom.geometry.computeBoundingSphere();
        meshes.push(atom);

        const sphereBody = new CANNON.Body({ mass: mass, shape: sphereShape });
        sphereBody.position.copy(atom.position);
        //sphereBody.velocity.x = Math.random(1)/11 - Math.random(1)/11;
        //sphereBody.velocity.y = Math.random(1)/11 - Math.random(1)/11;
        //sphereBody.velocity.z = Math.random(1)/11 - Math.random(1)/11;
        bodies.push(sphereBody);
        atomBodies.push(sphereBody);
        world.addBody(sphereBody);
        scene.add(atom);
        atoms.push(atom);
      }

      if (lineas[i].substring(13, 15).trim() == "CG") {
        resids.push(parseInt(lineas[i].substring(23, 26)));
        restypes.push(lineas[i].substring(17, 20).trim());
        atomNames.push(lineas[i].substring(13, 15).trim());

        const atom = new THREE.Mesh(atomGeometry, sulfurMaterial);

        atom.position.set(
          parseFloat(lineas[i].substring(30, 38)),
          parseFloat(lineas[i].substring(38, 46)),
          parseFloat(lineas[i].substring(46, 54))
        );
        atom.position.multiplyScalar(scale);
        atom.position.add(translation);
        atom.geometry.computeBoundingSphere();
        meshes.push(atom);

        const sphereBody = new CANNON.Body({ mass: mass, shape: sphereShape });
        sphereBody.position.copy(atom.position);
        bodies.push(sphereBody);
        atomBodies.push(sphereBody);
        world.addBody(sphereBody);
        scene.add(atom);
        atoms.push(atom);
      }
    }
  }

  let atomIndexes = [];

  atomNames.forEach((atom, index) => {
    for (let j = 0; j < elementNames.length; j++) {
      if (atom.substring(0, 1) === elementNames[j]) {
        atomIndexes[index] = j;
        break;
      }
    }
  });

  for (var j = 0; j < atomBodies.length; j++) {
    if (atomNames[j] === "CA") {
      for (var jj = j + 1; jj < atomBodies.length; jj++) {
        if (atomNames[jj] === "CA" && resids[jj] - resids[j] == 1) {
          //CA - CA+1
          var c = new CANNON.DistanceConstraint(
            atomBodies[jj],
            atomBodies[j],
            undefined,
            1e6
          );
          world.addConstraint(c);
        } else if (atomNames[jj] === "CG" && resids[jj] == resids[j]) {
          //CA - CB
          var c = new CANNON.DistanceConstraint(
            atomBodies[jj],
            atomBodies[j],
            undefined,
            1e3
          );
          world.addConstraint(c);
        } else {
          var distance = Math.sqrt(
            Math.pow(atomBodies[j].position.x - atomBodies[jj].position.x, 2) +
              Math.pow(
                atomBodies[j].position.y - atomBodies[jj].position.y,
                2
              ) +
              Math.pow(atomBodies[j].position.z - atomBodies[jj].position.z, 2)
          );
          if (distance < 0.25) {
            var c = new CANNON.DistanceConstraint(
              atomBodies[jj],
              atomBodies[j],
              undefined,
              10
            );
            world.addConstraint(c);
            // console.log(j + " - " + jj + "  " + distance);
          }
        }
      }
    }
  }
}
