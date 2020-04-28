import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.112.1/build/three.module.js';


export const textures = (function() {
  return {
    // Originally I planned to do texture atlasing, then got lazy.
    TextureAtlas: class {
      constructor(game) {
        this._game = game;
        this._Create(game);
        this.onLoad = () => {};
      }

      _Create(game) {
        this._manager = new THREE.LoadingManager();
        this._loader = new THREE.TextureLoader(this._manager);
        this._textures = {};

        this._manager.onLoad = () => {
          this._OnLoad();
        };

        this._game = game;
      }

      get Info() {
        return this._textures;
      }

      _OnLoad() {
        this.onLoad();
      }

      _LoadType(name, textureNames, offset, colourRange) {
        this._textures[name] = {
          colourRange: colourRange,
          uvOffset: [
              offset.x,
              offset.y,
          ],
          textures: textureNames.map(n => this._loader.load(n))
        };
        if (this._textures[name].textures.length > 1) {
        } else {
          const caps = this._game._graphics._threejs.capabilities;
          const aniso = caps.getMaxAnisotropy();

          this._textures[name].texture = this._textures[name].textures[0];
          this._textures[name].texture.minFilter = THREE.LinearMipMapLinearFilter;
          this._textures[name].texture.magFilter = THREE.NearestFilter;
          this._textures[name].texture.wrapS = THREE.RepeatWrapping;
          this._textures[name].texture.wrapT = THREE.RepeatWrapping;
          this._textures[name].texture.anisotropy = aniso;
        }
      }
    }
  };
})();
