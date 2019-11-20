import { colors, files } from "./utils";
var nrrd = require("nrrd-js");

// ###############################################
// Classic ThreeJS setup
// ###############################################

const container = document.getElementById("container");
const renderer = new THREE.WebGLRenderer({
  antialias: true
});
renderer.setSize(container.offsetWidth, container.offsetHeight);
renderer.setClearColor(colors.darkGrey, 1);
renderer.setPixelRatio(window.devicePixelRatio);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  60,
  container.offsetWidth / container.offsetHeight,
  0.1,
  10000
);
camera.position.x = 150;
camera.position.y = 150;
camera.position.z = 100;

const controls = new AMI.TrackballControl(camera, container);

const onWindowResize = () => {
  camera.aspect = container.offsetWidth / container.offsetHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(container.offsetWidth, container.offsetHeight);
};

window.addEventListener("resize", onWindowResize, false);

// ###############################################
// Load local dicom files
// ###############################################

var local_files = [];
var pullfiles = function() {
  var fileInput = document.querySelector("#fileItem");
  var filesInput = fileInput.files;

  // convert files object to an array
  for (var i = 0; i < filesInput.length; i++) {
    // we need to access the files via a Object URL
    local_files.push(window.URL.createObjectURL(filesInput[i]));
  }

  const loader = new AMI.VolumeLoader(container);
  loader
    .load(local_files)
    .then(() => {
      const series = loader.data[0].mergeSeries(loader.data);
      const stack = series[0].stack[0];
      loader.free();

      // prepare the stack (should compute some orientation information etc..)
      stack.prepare();
      // log some metadata
      console.log(stack.dimensionsIJK);
      console.log(stack.origin);

      // getPixelData(stack, coordinate) in core.utils should give value at coord
      // this is just for demonstration purposes
      var coord = new THREE.Vector3(0, 0, 0);
      var pixelData = AMI.UtilsCore.getPixelData(stack, coord);
      console.log(pixelData);

      const stackHelper = new AMI.StackHelper(stack);
      stackHelper.bbox.color = colors.red;
      stackHelper.border.color = colors.blue;

      scene.add(stackHelper);

      // build the gui
      gui(stackHelper);

      // center camera and interactor to center of bouding box
      const centerLPS = stackHelper.stack.worldCenter();
      camera.lookAt(centerLPS.x, centerLPS.y, centerLPS.z);
      camera.updateProjectionMatrix();
      controls.target.set(centerLPS.x, centerLPS.y, centerLPS.z);
    })
    .catch(error => {
      window.console.log("oops... something went wrong...");
      window.console.log(error.message);
    });

  const animate = () => {
    controls.update();
    renderer.render(scene, camera);

    requestAnimationFrame(() => {
      animate();
    });
  };
  animate();

  // setup gui
  const gui = stackHelper => {
    const stack = stackHelper.stack;
    const gui = new dat.GUI({
      autoPlace: false
    });
    const customContainer = document.getElementById("my-gui-container");
    customContainer.appendChild(gui.domElement);

    // stack
    const stackFolder = gui.addFolder("Stack");
    // index range depends on stackHelper orientation.
    const index = stackFolder
      .add(stackHelper, "index", 0, stack.dimensionsIJK.z - 1)
      .step(1)
      .listen();
    const orientation = stackFolder
      .add(stackHelper, "orientation", 0, 2)
      .step(1)
      .listen();
    orientation.onChange(value => {
      index.__max = stackHelper.orientationMaxIndex;
      stackHelper.index = Math.floor(index.__max / 2);
    });
    stackFolder.open();

    // slice
    const sliceFolder = gui.addFolder("Slice");
    sliceFolder
      .add(
        stackHelper.slice,
        "windowWidth",
        1,
        stack.minMax[1] - stack.minMax[0]
      )
      .step(1)
      .listen();
    sliceFolder
      .add(stackHelper.slice, "windowCenter", stack.minMax[0], stack.minMax[1])
      .step(1)
      .listen();
    sliceFolder.add(stackHelper.slice, "intensityAuto").listen();
    sliceFolder.add(stackHelper.slice, "invert");
    sliceFolder.open();

    // bbox
    const bboxFolder = gui.addFolder("Bounding Box");
    bboxFolder.add(stackHelper.bbox, "visible");
    bboxFolder.addColor(stackHelper.bbox, "color");
    bboxFolder.open();

    // border
    const borderFolder = gui.addFolder("Border");
    borderFolder.add(stackHelper.border, "visible");
    borderFolder.addColor(stackHelper.border, "color");
    borderFolder.open();

    downloadAsNRRD(stack);
  };
};

document.querySelector("#fileItem").onchange = pullfiles;

// ###############################################
// Combine and download as NRRD
// ###############################################

var downloadAsNRRD = function(stack) {
  let volume_dim0 = stack.dimensionsIJK.x;
  let volume_dim1 = stack.dimensionsIJK.y;
  let volume_dim2 = stack.dimensionsIJK.z;

  let size = volume_dim0 * volume_dim1 * volume_dim2;
  console.log("Writing to data array...");
  let data = [];
  let j = 0;
  for (let z = 0; z < volume_dim2; z += 1) {
    for (let y = 0; y < volume_dim1; y++) {
      for (let x = 0; x < volume_dim0; x++) {
        // https://github.com/FNNDSC/ami/blob/master/src/core/core.utils.js
        var coord = new THREE.Vector3(x, y, z);
        data[j] = AMI.UtilsCore.getPixelData(stack, coord);
        j++;
        if (j % 100000 === 0) {
          console.log((j / size) * 100);
        }
      }
    }
  }

  let encoding_type = "text";

  // compression is disabled for now, since in this POC we use the
  // original version of nrrd-js, which does not support compression yet
  //let compressed = document.getElementById("compressed").checked;
  //if (compressed) {
  //  console.log("Compressed!");
  //  encoding_type = 'gzip';
  //}

  var testData = {
    data: data,
    type: "float",
    endian: "little",
    encoding: encoding_type,
    kinds: ["domain", "domain", "domain"],
    sizes: [stack.dimensionsIJK.x, stack.dimensionsIJK.y, stack.dimensionsIJK.z]
  };
  let spaceOrigin = [];

  // TODO: we still need to find a way to get the proper origin here...
  // http://teem.sourceforge.net/nrrd/format.html#space
  for (let i = 0; i < 3; i += 1) {
    //spaceOrigin[i] = parseFloat(stack.origin[i]);
    spaceOrigin[i] = 0.0;
  }

  // TODO: as well as the proper directions and space...
  //testData.spaceDirections = volume.directions;
  testData.spaceOrigin = spaceOrigin;
  testData.space = "left-posterior-superior";

  console.log(testData);
  console.log("Serializing...");

  var nrrdData = new Buffer(new Uint8Array(nrrd.serialize(testData)));

  downloadVolume(nrrdData, false, "volume.nrrd");
};

// download the nrrd file
function downloadVolume(nrrd, compressed, filename) {
  let a = window.document.createElement("a");
  if (compressed) {
    a.href = makeBinaryFile(nrrd);
  } else {
    nrrd = new String(nrrd);
    a.href = makeTextFile(nrrd);
  }
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// from: http://jsfiddle.net/UselessCode/qm5AG/
// create file blob to download
// since we use text-encoding for the NRRD we can encode the blob as text as well
let text_file = null,
  makeTextFile = function(text) {
    let data = new Blob([text], { type: "text/plain" });

    // If we are replacing a previously generated file we need to
    // manually revoke the object URL to avoid memory leaks.
    if (text_file !== null) {
      window.URL.revokeObjectURL(text_file);
    }

    text_file = window.URL.createObjectURL(data);

    return text_file;
  };

// if we later want to use compression we need to encode the blob as a binary file
let binary_file = null,
  makeBinaryFile = function(data) {
    let content = new Blob([data], { type: "octet/stream" });

    // If we are replacing a previously generated file we need to
    // manually revoke the object URL to avoid memory leaks.
    if (binary_file !== null) {
      window.URL.revokeObjectURL(binary_file);
    }

    binary_file = window.URL.createObjectURL(content);

    return binary_file;
  };
