import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js';
import {GUI} from 'https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/libs/dat.gui.module.js';
import {Sky} from 'https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/objects/Sky.js';
import {game} from './game.js';
import {graphics} from './graphics.js';
import {math} from './math.js';
import {noise} from './noise.js';
import {spline} from './spline.js';
import {textures} from './textures.js';

import {OrbitControls} from 'https://cdn.jsdelivr.net/npm/three@0.112.1/examples/jsm/controls/OrbitControls.js';


let _APP = null;


class HeightGenerator {
  constructor(generator, position, minRadius, maxRadius) {
    this._position = position.clone();
    this._radius = [minRadius, maxRadius];
    this._generator = generator;
  }

  Get(x, y) {
    const distance = this._position.distanceTo(new THREE.Vector2(x, y));
    let normalization = 1.0 - math.sat(
        (distance - this._radius[0]) / (this._radius[1] - this._radius[0]));
    normalization = normalization * normalization * (3 - 2 * normalization);

    return [this._generator.Get(x, y), normalization];
  }
}

class FlaredCornerHeightGenerator {
  constructor() {
  }

  Get(x, y) {
    if (x == -250 && y == 250) {
      return [128, 1];
    }
    return [0, 1];
  }
}


class BumpHeightGenerator {
  constructor() {
  }

  Get(x, y) {
    const dist = new THREE.Vector2(x, y).distanceTo(new THREE.Vector2(0, 0));

    let h = 1.0 - math.sat(dist / 250.0);
    h = h * h * h * (h * (h * 6 - 15) + 10);

    return [h * 128, 1];
  }
}


class Heightmap {
  constructor(params, img) {
    this._params = params;
    this._data = graphics.GetImageData(img);
  }

  Get(x, y) {
    const _GetPixelAsFloat = (x, y) => {
      const position = (x + this._data.width * y) * 4;
      const data = this._data.data;
      return data[position] / 255.0;
    }

    // Bilinear filter
    const offset = new THREE.Vector2(-250, -250);
    const dimensions = new THREE.Vector2(500, 500);

    const xf = 1.0 - math.sat((x - offset.x) / dimensions.x);
    const yf = math.sat((y - offset.y) / dimensions.y);
    const w = this._data.width - 1;
    const h = this._data.height - 1;

    const x1 = Math.floor(xf * w);
    const y1 = Math.floor(yf * h);
    const x2 = math.clamp(x1 + 1, 0, w);
    const y2 = math.clamp(y1 + 1, 0, h);

    const xp = xf * w - x1;
    const yp = yf * h - y1;

    const p11 = _GetPixelAsFloat(x1, y1);
    const p21 = _GetPixelAsFloat(x2, y1);
    const p12 = _GetPixelAsFloat(x1, y2);
    const p22 = _GetPixelAsFloat(x2, y2);

    const px1 = math.lerp(xp, p11, p21);
    const px2 = math.lerp(xp, p12, p22);

    return math.lerp(yp, px1, px2) * this._params.height;
  }
}



class TerrainChunk {
  constructor(params) {
    this._params = params;
    this._Init(params);
  }

  _Init(params) {
    const size = new THREE.Vector3(
        params.width * params.scale, 0, params.width * params.scale);

    this._plane = new THREE.Mesh(
        new THREE.PlaneGeometry(size.x, size.z, 128, 128),
        new THREE.MeshStandardMaterial({
            wireframe: false,
            color: 0xFFFFFF,
            side: THREE.FrontSide,
            vertexColors: THREE.VertexColors,
        }));
    this._plane.position.add(params.offset);
    this._plane.castShadow = false;
    this._plane.receiveShadow = true;
    params.group.add(this._plane);

    this.Rebuild();
  }

  Rebuild() {
    const offset = this._params.offset;
    for (let v of this._plane.geometry.vertices) {
      const heightPairs = [];
      let normalization = 0;
      v.z = 0;
      for (let gen of this._params.heightGenerators) {
        heightPairs.push(gen.Get(v.x + offset.x, v.y + offset.y));
        normalization += heightPairs[heightPairs.length-1][1];
      }

      if (normalization > 0) {
        for (let h of heightPairs) {
          v.z += h[0] * h[1] / normalization;
        }
      }
    }

    // DEMO
    if (this._params.heightGenerators.length > 1 && offset.x == 0 && offset.y == 0) {
      const gen = this._params.heightGenerators[0];
      const maxHeight = 16.0;
      const GREEN = new THREE.Color(0x46b00c);

      for (let f of this._plane.geometry.faces) {
        const vs = [
            this._plane.geometry.vertices[f.a],
            this._plane.geometry.vertices[f.b],
            this._plane.geometry.vertices[f.c]
        ];

        const vertexColours = [];
        for (let v of vs) {
          const [h, _] = gen.Get(v.x + offset.x, v.y + offset.y);
          const a = math.sat(h / maxHeight);
          const vc = new THREE.Color(0xFFFFFF);
          vc.lerp(GREEN, a);

          vertexColours.push(vc);
        }
        f.vertexColors = vertexColours;
      }
      this._plane.geometry.elementsNeedUpdate = true;
    } else {
      for (let f of this._plane.geometry.faces) {
        f.vertexColors = [
            new THREE.Color(0xFFFFFF),
            new THREE.Color(0xFFFFFF),
            new THREE.Color(0xFFFFFF),
        ];
      }

    }
    this._plane.geometry.verticesNeedUpdate = true;
    this._plane.geometry.computeVertexNormals();
  }
}

class TerrainChunkManager {
  constructor(params) {
    this._chunkSize = 500;
    this._Init(params);
  }

  _Init(params) {
    this._InitNoise(params);
    this._InitTerrain(params);
  }

  _InitNoise(params) {
    params.guiParams.noise = {
      octaves: 10,
      persistence: 0.5,
      lacunarity: 2.0,
      exponentiation: 3.9,
      height: 64,
      scale: 256.0,
      noiseType: 'simplex',
      seed: 1
    };

    const onNoiseChanged = () => {
      for (let k in this._chunks) {
        this._chunks[k].chunk.Rebuild();
      }
    };

    const noiseRollup = params.gui.addFolder('Terrain.Noise');
    noiseRollup.add(params.guiParams.noise, "noiseType", ['simplex', 'perlin']).onChange(
        onNoiseChanged);
    noiseRollup.add(params.guiParams.noise, "scale", 64.0, 1024.0).onChange(
        onNoiseChanged);
    noiseRollup.add(params.guiParams.noise, "octaves", 1, 20, 1).onChange(
        onNoiseChanged);
    noiseRollup.add(params.guiParams.noise, "persistence", 0.01, 1.0).onChange(
        onNoiseChanged);
    noiseRollup.add(params.guiParams.noise, "lacunarity", 0.01, 4.0).onChange(
        onNoiseChanged);
    noiseRollup.add(params.guiParams.noise, "exponentiation", 0.1, 10.0).onChange(
        onNoiseChanged);
    noiseRollup.add(params.guiParams.noise, "height", 0, 256).onChange(
        onNoiseChanged);

    this._noise = new noise.Noise(params.guiParams.noise);

    params.guiParams.heightmap = {
      height: 16,
    };

    const heightmapRollup = params.gui.addFolder('Terrain.Heightmap');
    heightmapRollup.add(params.guiParams.heightmap, "height", 0, 128).onChange(
        onNoiseChanged);
  }

  _InitTerrain(params) {
    params.guiParams.terrain= {
      wireframe: false,
    };

    this._group = new THREE.Group()
    this._group.rotation.x = -Math.PI / 2;
    params.scene.add(this._group);

    const terrainRollup = params.gui.addFolder('Terrain');
    terrainRollup.add(params.guiParams.terrain, "wireframe").onChange(() => {
      for (let k in this._chunks) {
        this._chunks[k].chunk._plane.material.wireframe = params.guiParams.terrain.wireframe;
      }
    });

    this._chunks = {};
    this._params = params;

    // DEMO
    // this._AddChunk(0, 0);

    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        this._AddChunk(x, z);
      }
    }
  }

  _Key(x, z) {
    return x + '.' + z;
  }

  _AddChunk(x, z) {
    const offset = new THREE.Vector2(x * this._chunkSize, z * this._chunkSize);
    const chunk = new TerrainChunk({
      group: this._group,
      offset: new THREE.Vector3(offset.x, offset.y, 0),
      scale: 1,
      width: this._chunkSize,
      heightGenerators: [new HeightGenerator(this._noise, offset, 100000, 100000 + 1)],
    });

    const k = this._Key(x, z);
    const edges = [];
    for (let xi = -1; xi <= 1; xi++) {
      for (let zi = -1; zi <= 1; zi++) {
        if (xi == 0 || zi == 0) {
          continue;
        }
        edges.push(this._Key(x + xi, z + zi));
      }
    }

    this._chunks[k] = {
      chunk: chunk,
      edges: edges
    };
  }

  SetHeightmap(img) {
    const heightmap = new HeightGenerator(
        new Heightmap(this._params.guiParams.heightmap, img),
        new THREE.Vector2(0, 0), 250, 300);

    for (let k in this._chunks) {
      this._chunks[k].chunk._params.heightGenerators.unshift(heightmap);
      this._chunks[k].chunk.Rebuild();
    }
  }

  Update(timeInSeconds) {
  }
}


class TerrainSky {
  constructor(params) {
    this._Init(params);
  }

  _Init(params) {
    this._sky = new Sky();
    this._sky.scale.setScalar(10000);
    params.scene.add(this._sky);

    params.guiParams.sky = {
      turbidity: 10.0,
      rayleigh: 2,
      mieCoefficient: 0.005,
      mieDirectionalG: 0.8,
      luminance: 1,
    };

    params.guiParams.sun = {
      inclination: 0.31,
      azimuth: 0.25,
    };

    const onShaderChange = () => {
      for (let k in params.guiParams.sky) {
        this._sky.material.uniforms[k].value = params.guiParams.sky[k];
      }
      for (let k in params.guiParams.general) {
        this._sky.material.uniforms[k].value = params.guiParams.general[k];
      }
    };

    const onSunChange = () => {
      var theta = Math.PI * (params.guiParams.sun.inclination - 0.5);
      var phi = 2 * Math.PI * (params.guiParams.sun.azimuth - 0.5);

      const sunPosition = new THREE.Vector3();
      sunPosition.x = Math.cos(phi);
      sunPosition.y = Math.sin(phi) * Math.sin(theta);
      sunPosition.z = Math.sin(phi) * Math.cos(theta);

      this._sky.material.uniforms['sunPosition'].value.copy(sunPosition);
    };

    const skyRollup = params.gui.addFolder('Sky');
    skyRollup.add(params.guiParams.sky, "turbidity", 0.1, 30.0).onChange(
        onShaderChange);
    skyRollup.add(params.guiParams.sky, "rayleigh", 0.1, 4.0).onChange(
        onShaderChange);
    skyRollup.add(params.guiParams.sky, "mieCoefficient", 0.0001, 0.1).onChange(
        onShaderChange);
    skyRollup.add(params.guiParams.sky, "mieDirectionalG", 0.0, 1.0).onChange(
        onShaderChange);
    skyRollup.add(params.guiParams.sky, "luminance", 0.0, 2.0).onChange(
        onShaderChange);

    const sunRollup = params.gui.addFolder('Sun');
    sunRollup.add(params.guiParams.sun, "inclination", 0.0, 1.0).onChange(
        onSunChange);
    sunRollup.add(params.guiParams.sun, "azimuth", 0.0, 1.0).onChange(
        onSunChange);

    onShaderChange();
    onSunChange();
  }

  Update(timeInSeconds) {
  }
}

class ProceduralTerrain_Demo extends game.Game {
  constructor() {
    super();
  }

  _OnInitialize() {
    this._textures = new textures.TextureAtlas(this);
    this._textures.onLoad = () => {};
    this._controls = this._CreateControls();
    this._CreateGUI();

    this._entities['_terrain'] = new TerrainChunkManager({
      scene: this._graphics.Scene,
      gui: this._gui,
      guiParams: this._guiParams,
    });

    this._entities['_sky'] = new TerrainSky({
      scene: this._graphics.Scene,
      gui: this._gui,
      guiParams: this._guiParams,
    });
    this._LoadBackground();
  }

  _CreateGUI() {
    this._guiParams = {
      general: {
      },
    };
    this._gui = new GUI();

    const generalRollup = this._gui.addFolder('General');
    this._gui.close();
  }

  _CreateControls() {
    const controls = new OrbitControls(
        this._graphics._camera, this._graphics._threejs.domElement);
    controls.target.set(0, 50, 0);
    controls.object.position.set(475, 345, 900);
    controls.update();
    return controls;
  }

  _LoadBackground() {
    const loader = new THREE.TextureLoader(this._manager);

    loader.load('./resources/heightmap-simondev.jpg', (result) => {
      this._entities['_terrain'].SetHeightmap(result.image);
    });
  }

  _OnStep(timeInSeconds) {
  }
}


function _Main() {
  _APP = new ProceduralTerrain_Demo();
}

_Main();
