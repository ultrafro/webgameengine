var APP = {

	Player: function () {

		var renderer = new THREE.WebGLRenderer( { antialias: true } );
		renderer.setPixelRatio( window.devicePixelRatio );
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		var loader = new THREE.ObjectLoader();
		var camera, scene;

		var events = {};

		var dom = document.createElement( 'div' );
		dom.appendChild( renderer.domElement );

		this.dom = dom;
		this.canvas = renderer.domElement;

		this.width = 500;
		this.height = 500;

		// Physics state
		var physicsWorld = null;
		var rapier = null;
		var physicsObjects = []; // { mesh, rigidBody, collider }
		var characterController = null;
		var characterBody = null;
		var characterCollider = null;
		var characterMesh = null;
		var characterGroup = null;
		var keys = {};
		var cameraDistance = 8;
		var cameraHeight = 3;
		var cameraTarget = new THREE.Vector3();
		var characterVelocity = new THREE.Vector3();
		var characterOnGround = false;
		var characterYVelocity = 0;
		var cameraAngle = 0;
		var cameraPitch = 0.3; // radians, slight downward look
		var animationMixer = null;
		var animations = {};
		var currentAnimation = null;

		var self = this;

		this.load = function ( json ) {

			var project = json.project;

			if ( project.shadows !== undefined ) renderer.shadowMap.enabled = project.shadows;
			if ( project.shadowType !== undefined ) renderer.shadowMap.type = project.shadowType;
			if ( project.toneMapping !== undefined ) renderer.toneMapping = project.toneMapping;
			if ( project.toneMappingExposure !== undefined ) renderer.toneMappingExposure = project.toneMappingExposure;

			this.setScene( loader.parse( json.scene ) );
			this.setCamera( loader.parse( json.camera ) );

			events = {
				init: [],
				start: [],
				stop: [],
				keydown: [],
				keyup: [],
				pointerdown: [],
				pointerup: [],
				pointermove: [],
				update: []
			};

			var scriptWrapParams = 'player,renderer,scene,camera';
			var scriptWrapResultObj = {};

			for ( var eventKey in events ) {

				scriptWrapParams += ',' + eventKey;
				scriptWrapResultObj[ eventKey ] = eventKey;

			}

			var scriptWrapResult = JSON.stringify( scriptWrapResultObj ).replace( /\"/g, '' );

			for ( var uuid in json.scripts ) {

				var object = scene.getObjectByProperty( 'uuid', uuid, true );

				if ( object === undefined ) {

					console.warn( 'APP.Player: Script without object.', uuid );
					continue;

				}

				var scripts = json.scripts[ uuid ];

				for ( var i = 0; i < scripts.length; i ++ ) {

					var script = scripts[ i ];

					var functions = ( new Function( scriptWrapParams, script.source + '\nreturn ' + scriptWrapResult + ';' ).bind( object ) )( this, renderer, scene, camera );

					for ( var name in functions ) {

						if ( functions[ name ] === undefined ) continue;

						if ( events[ name ] === undefined ) {

							console.warn( 'APP.Player: Event type not supported (', name, ')' );
							continue;

						}

						events[ name ].push( functions[ name ].bind( object ) );

					}

				}

			}

			dispatch( events.init, arguments );

		};

		this.setCamera = function ( value ) {

			camera = value;
			camera.aspect = this.width / this.height;
			camera.updateProjectionMatrix();

		};

		this.setScene = function ( value ) {

			scene = value;

			// Set a default sky background if none
			if ( ! scene.background ) {

				scene.background = new THREE.Color( 0x87ceeb );

			}

		};

		this.setPixelRatio = function ( pixelRatio ) {

			renderer.setPixelRatio( pixelRatio );

		};

		this.setSize = function ( width, height ) {

			this.width = width;
			this.height = height;

			if ( camera ) {

				camera.aspect = this.width / this.height;
				camera.updateProjectionMatrix();

			}

			renderer.setSize( width, height );

		};

		function dispatch( array, event ) {

			for ( var i = 0, l = array.length; i < l; i ++ ) {

				array[ i ]( event );

			}

		}

		// Physics initialization
		async function initPhysics() {

			try {

				// Dynamic import Rapier from CDN
				var module = await import( 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.14.0/+esm' );
				rapier = module;
				await rapier.init();

				physicsWorld = new rapier.World( { x: 0.0, y: -9.81, z: 0.0 } );

				console.log( 'Physics: Rapier initialized' );

				// Scan scene for physics objects
				// First pass: find objects with physics, skip decorative children
				var characterParents = new Set();

				scene.traverse( function ( child ) {

					if ( child.userData && child.userData.physics ) {

						if ( child.userData.physics.bodyType === 'kinematicCharacter' ) {

							// Mark the parent group so we skip siblings
							if ( child.parent ) characterParents.add( child.parent );

						}

					}

				} );

				scene.traverse( function ( child ) {

					if ( child.userData && child.userData.physics ) {

						// Skip decorative parts of character (head, eyes, etc.)
						if ( child.parent && characterParents.has( child.parent ) &&
							child.userData.physics.bodyType !== 'kinematicCharacter' ) {

							return;

						}

						var config = child.userData.physics;
						addPhysicsBody( child, config );

					}

				} );

				console.log( 'Physics: ' + physicsObjects.length + ' physics objects created' );

			} catch ( e ) {

				console.error( 'Physics: Failed to initialize Rapier', e );

			}

		}

		function addPhysicsBody( mesh, config ) {

			if ( ! physicsWorld || ! rapier ) return;

			var bodyDesc;
			var isCharacter = config.bodyType === 'kinematicCharacter';

			if ( config.bodyType === 'dynamic' ) {

				bodyDesc = rapier.RigidBodyDesc.dynamic();

			} else if ( config.bodyType === 'fixed' || config.bodyType === 'static' ) {

				bodyDesc = rapier.RigidBodyDesc.fixed();

			} else if ( config.bodyType === 'kinematic' || isCharacter ) {

				bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased();

			} else {

				bodyDesc = rapier.RigidBodyDesc.dynamic();

			}

			// Use world position, not local
			var worldPos = new THREE.Vector3();
			mesh.getWorldPosition( worldPos );
			bodyDesc.setTranslation( worldPos.x, worldPos.y, worldPos.z );

			// Only apply rotation for non-ground objects
			// Ground planes use explicit cuboid half-extents, no rotation needed
			if ( config.bodyType !== 'fixed' || config.collider !== 'cuboid' || ! config.hx ) {

				var worldQuat = new THREE.Quaternion();
				mesh.getWorldQuaternion( worldQuat );
				bodyDesc.setRotation( {
					x: worldQuat.x,
					y: worldQuat.y,
					z: worldQuat.z,
					w: worldQuat.w
				} );

			}

			var rigidBody = physicsWorld.createRigidBody( bodyDesc );

			// Create collider
			var colliderDesc;

			if ( config.collider === 'sphere' ) {

				var radius = config.radius || 1;
				colliderDesc = rapier.ColliderDesc.ball( radius );

			} else if ( config.collider === 'capsule' ) {

				var halfHeight = config.halfHeight || 0.4;
				var radius = config.radius || 0.3;
				colliderDesc = rapier.ColliderDesc.capsule( halfHeight, radius );

			} else if ( config.collider === 'cuboid' ) {

				var hx, hy, hz;

				if ( config.hx !== undefined ) {

					// Use explicit half-extents from config (e.g. ground planes)
					hx = config.hx;
					hy = config.hy || 0.05;
					hz = config.hz;

				} else if ( mesh.geometry ) {

					mesh.geometry.computeBoundingBox();
					var bb = mesh.geometry.boundingBox;
					hx = ( bb.max.x - bb.min.x ) * mesh.scale.x / 2;
					hy = ( bb.max.y - bb.min.y ) * mesh.scale.y / 2;
					hz = ( bb.max.z - bb.min.z ) * mesh.scale.z / 2;
					// Ensure minimum thickness
					hx = Math.max( hx, 0.01 );
					hy = Math.max( hy, 0.01 );
					hz = Math.max( hz, 0.01 );

				} else {

					hx = 0.5;
					hy = 0.5;
					hz = 0.5;

				}

				colliderDesc = rapier.ColliderDesc.cuboid( hx, hy, hz );
				console.log( 'Physics: cuboid', mesh.name, 'half-extents:', hx, hy, hz, 'pos:', worldPos.x, worldPos.y, worldPos.z );

			} else {

				// Default: compute from bounding box
				if ( mesh.geometry ) {

					mesh.geometry.computeBoundingBox();
					var bb = mesh.geometry.boundingBox;
					var hx = ( bb.max.x - bb.min.x ) * mesh.scale.x / 2;
					var hy = ( bb.max.y - bb.min.y ) * mesh.scale.y / 2;
					var hz = ( bb.max.z - bb.min.z ) * mesh.scale.z / 2;
					colliderDesc = rapier.ColliderDesc.cuboid( Math.max(hx, 0.01), Math.max(hy, 0.01), Math.max(hz, 0.01) );

				} else {

					colliderDesc = rapier.ColliderDesc.cuboid( 0.5, 0.5, 0.5 );

				}

			}

			if ( config.friction !== undefined ) colliderDesc.setFriction( config.friction );
			if ( config.restitution !== undefined ) colliderDesc.setRestitution( config.restitution );

			var collider = physicsWorld.createCollider( colliderDesc, rigidBody );

			var entry = { mesh: mesh, rigidBody: rigidBody, collider: collider, config: config };
			physicsObjects.push( entry );

			// Character controller setup (only create once)
			if ( isCharacter && ! characterController ) {

				characterController = physicsWorld.createCharacterController( 0.01 );
				characterController.enableAutostep( 0.3, 0.2, true );
				characterController.enableSnapToGround( 0.3 );
				characterController.setApplyImpulsesToDynamicBodies( true );
				characterBody = rigidBody;
				characterCollider = collider;
				characterMesh = mesh;

				// Check if there's a parent group
				if ( mesh.parent && mesh.parent !== scene ) {

					characterGroup = mesh.parent;

				}

				console.log( 'Physics: Character controller created for', mesh.name );

			}

		}

		async function setupCharacterAnimations( mesh ) {

			if ( ! characterGroup ) return;

			// Check if this is an animated GLB character
			var charData = characterGroup.userData.animatedCharacter;

			if ( charData && charData.modelUrl ) {

				// Load the model fresh in the player (editor scene doesn't preserve animations in JSON)
				try {

					var module = await import( '/examples/jsm/loaders/GLTFLoader.js' );
					var loader = new module.GLTFLoader();

					var gltf = await new Promise( function ( resolve, reject ) {
						loader.load( charData.modelUrl, resolve, undefined, reject );
					} );

					var model = gltf.scene;
					model.scale.setScalar( charData.scale || 1 );
					model.position.y = charData.yOffset || 0;

					model.traverse( function ( child ) {
						if ( child.isMesh ) {
							child.castShadow = true;
							child.receiveShadow = true;
						}
					} );

					// Find and remove the old model from characterGroup (keep the collider mesh)
					var toRemove = [];
					characterGroup.children.forEach( function ( child ) {
						if ( child !== characterMesh && child.name !== 'PlayerBody' ) {
							toRemove.push( child );
						}
					} );
					toRemove.forEach( function ( child ) { characterGroup.remove( child ); } );

					// Add the freshly loaded model
					characterGroup.add( model );

					// Set up real AnimationMixer
					var realMixer = new THREE.AnimationMixer( model );
					var clips = {};
					var animMap = charData.animationMap || {};

					gltf.animations.forEach( function ( clip ) {
						clips[ clip.name ] = realMixer.clipAction( clip );
					} );

					// Find the right clips for each state
					var idleClip = clips[ animMap.idle ] || clips[ 'Idle' ] || null;
					var walkClip = clips[ animMap.walk ] || clips[ 'Walk' ] || clips[ 'Walking' ] || null;
					var runClip = clips[ animMap.run ] || clips[ 'Run' ] || clips[ 'Running' ] || null;

					// Start with idle
					if ( idleClip ) idleClip.play();
					var currentAction = idleClip;

					animationMixer = {
						mixer: realMixer,
						clips: clips,
						currentAction: currentAction,
						state: 'idle',
						setState: function ( state ) {

							if ( this.state === state ) return;
							this.state = state;

							var nextAction = null;

							if ( state === 'run' && runClip ) nextAction = runClip;
							else if ( state === 'walk' && walkClip ) nextAction = walkClip;
							else if ( idleClip ) nextAction = idleClip;

							if ( nextAction && nextAction !== this.currentAction ) {

								if ( this.currentAction ) {
									this.currentAction.fadeOut( 0.2 );
								}

								nextAction.reset().fadeIn( 0.2 ).play();
								this.currentAction = nextAction;

							}

						},
						update: function ( delta ) {

							this.mixer.update( delta );

						}
					};

					console.log( 'Animations: Loaded', Object.keys( clips ).join( ', ' ), 'for', charData.modelName );

				} catch ( e ) {

					console.error( 'Failed to load character animations:', e );
					setupProceduralAnimations();

				}

			} else {

				setupProceduralAnimations();

			}

		}

		function setupProceduralAnimations() {

			// Fallback procedural animations for primitive characters
			animationMixer = {
				time: 0,
				state: 'idle',
				setState: function( state ) {
					if ( this.state !== state ) {
						this.state = state;
					}
				},
				update: function( delta ) {
					this.time += delta;
					if ( characterMesh ) {
						if ( this.state === 'run' ) {
							characterMesh.position.y = Math.sin( this.time * 12 ) * 0.05;
							characterMesh.rotation.x = 0.1;
						} else if ( this.state === 'walk' ) {
							characterMesh.position.y = Math.sin( this.time * 8 ) * 0.03;
							characterMesh.rotation.x = 0.05;
						} else {
							characterMesh.position.y = Math.sin( this.time * 2 ) * 0.02;
							characterMesh.rotation.x = 0;
						}
					}
				}
			};

		}

		function updatePhysics( delta ) {

			if ( ! physicsWorld ) return;

			var dt = Math.min( delta / 1000, 0.05 ); // cap at 50ms

			// Character movement
			if ( characterController && characterBody && characterCollider ) {

				var speed = 3.0;
				var runMultiplier = keys[ 'ShiftLeft' ] || keys[ 'ShiftRight' ] ? 1.8 : 1.0;
				var moveSpeed = speed * runMultiplier;

				// Calculate movement direction based on camera angle
				var forward = new THREE.Vector3( 0, 0, -1 );
				var right = new THREE.Vector3( 1, 0, 0 );

				forward.applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), cameraAngle );
				right.applyAxisAngle( new THREE.Vector3( 0, 1, 0 ), cameraAngle );

				var moveDir = new THREE.Vector3( 0, 0, 0 );
				var isMoving = false;

				if ( keys[ 'KeyW' ] || keys[ 'ArrowUp' ] ) { moveDir.add( forward ); isMoving = true; }
				if ( keys[ 'KeyS' ] || keys[ 'ArrowDown' ] ) { moveDir.sub( forward ); isMoving = true; }
				if ( keys[ 'KeyA' ] || keys[ 'ArrowLeft' ] ) { moveDir.sub( right ); isMoving = true; }
				if ( keys[ 'KeyD' ] || keys[ 'ArrowRight' ] ) { moveDir.add( right ); isMoving = true; }

				if ( moveDir.length() > 0 ) moveDir.normalize();

				// Gravity — always apply, check grounded after movement
				characterYVelocity -= 9.81 * dt;

				// Clamp terminal velocity
				if ( characterYVelocity < -20 ) characterYVelocity = -20;

				characterOnGround = characterController.computedGrounded();

				if ( characterOnGround ) {

					if ( characterYVelocity < 0 ) characterYVelocity = 0;

					if ( keys[ 'Space' ] ) {

						characterYVelocity = 5.0; // Jump

					}

				}

				var desiredMovement = {
					x: moveDir.x * moveSpeed * dt,
					y: characterYVelocity * dt,
					z: moveDir.z * moveSpeed * dt
				};

				characterController.computeColliderMovement( characterCollider, desiredMovement );

				var corrected = characterController.computedMovement();
				var currentPos = characterBody.translation();

				characterBody.setNextKinematicTranslation( {
					x: currentPos.x + corrected.x,
					y: currentPos.y + corrected.y,
					z: currentPos.z + corrected.z
				} );

				// Rotate character to face movement direction
				if ( isMoving && ( Math.abs( moveDir.x ) > 0.01 || Math.abs( moveDir.z ) > 0.01 ) ) {

					var targetAngle = Math.atan2( moveDir.x, moveDir.z ) + Math.PI;
					var currentRot = characterMesh.parent ? characterMesh.parent.rotation.y : 0;
					var angleDiff = targetAngle - currentRot;

					// Normalize angle
					while ( angleDiff > Math.PI ) angleDiff -= Math.PI * 2;
					while ( angleDiff < -Math.PI ) angleDiff += Math.PI * 2;

					var newAngle = currentRot + angleDiff * Math.min( 1, dt * 10 );

					if ( characterMesh.parent && characterMesh.parent !== scene ) {

						characterMesh.parent.rotation.y = newAngle;

					}

				}

				// Animation state
				if ( animationMixer ) {

					if ( isMoving ) {
						animationMixer.setState( runMultiplier > 1 ? 'run' : 'walk' );
					} else {
						animationMixer.setState( 'idle' );
					}

					animationMixer.update( dt );

				}

				// Update camera
				updateThirdPersonCamera( dt );

			}

			// Step physics
			physicsWorld.step();

			// Sync three.js meshes with physics bodies
			for ( var i = 0; i < physicsObjects.length; i ++ ) {

				var entry = physicsObjects[ i ];

				if ( entry.config.bodyType === 'dynamic' ) {

					var pos = entry.rigidBody.translation();
					var rot = entry.rigidBody.rotation();

					entry.mesh.position.set( pos.x, pos.y, pos.z );
					entry.mesh.quaternion.set( rot.x, rot.y, rot.z, rot.w );

				} else if ( entry.config.bodyType === 'kinematicCharacter' ) {

					var pos = entry.rigidBody.translation();

					// Update the parent group (which holds the visual)
					if ( entry.mesh.parent && entry.mesh.parent !== scene ) {

						entry.mesh.parent.position.set( pos.x, pos.y, pos.z );

					} else {

						entry.mesh.position.set( pos.x, pos.y, pos.z );

					}

				}

			}

		}

		function updateThirdPersonCamera( dt ) {

			if ( ! characterBody || ! camera ) return;

			var charPos = characterBody.translation();
			var targetPos = new THREE.Vector3( charPos.x, charPos.y + 1.2, charPos.z );

			// Camera orbits around character using spherical coordinates
			var horizontalDist = Math.cos( cameraPitch ) * cameraDistance;
			var verticalDist = Math.sin( cameraPitch ) * cameraDistance;

			var offsetX = Math.sin( cameraAngle ) * horizontalDist;
			var offsetZ = Math.cos( cameraAngle ) * horizontalDist;

			var desiredCamPos = new THREE.Vector3(
				targetPos.x + offsetX,
				targetPos.y + verticalDist,
				targetPos.z + offsetZ
			);

			// Don't let camera go below ground
			if ( desiredCamPos.y < 0.5 ) desiredCamPos.y = 0.5;

			// Direct camera follow
			camera.position.copy( desiredCamPos );
			cameraTarget.copy( targetPos );
			camera.lookAt( cameraTarget );

		}

		var time, startTime, prevTime;

		function animate() {

			time = performance.now();
			var delta = time - prevTime;

			try {

				updatePhysics( delta );
				dispatch( events.update, { time: time - startTime, delta: delta } );

			} catch ( e ) {

				console.error( ( e.message || e ), ( e.stack || '' ) );

			}

			renderer.render( scene, camera );

			prevTime = time;

		}

		this.play = async function () {

			startTime = prevTime = performance.now();

			keys = {};
			cameraAngle = 0;
			characterYVelocity = -1; // Start with downward velocity so character falls

			document.addEventListener( 'keydown', onKeyDown );
			document.addEventListener( 'keyup', onKeyUp );
			document.addEventListener( 'pointerdown', onPointerDown );
			document.addEventListener( 'pointerup', onPointerUp );
			document.addEventListener( 'pointermove', onPointerMove );

			// Lock pointer for mouse look
			dom.addEventListener( 'click', requestPointerLock );

			// Initialize physics
			await initPhysics();

			// Setup character animations (loads GLB model if needed)
			if ( characterMesh ) {
				await setupCharacterAnimations( characterMesh );
			}

			// Position camera behind character if we have one
			if ( characterBody && camera ) {

				updateThirdPersonCamera( 0 );
				camera.updateProjectionMatrix();
				console.log( 'Camera positioned behind character' );

			}

			dispatch( events.start, arguments );

			renderer.setAnimationLoop( animate );

		};

		this.stop = function () {

			document.removeEventListener( 'keydown', onKeyDown );
			document.removeEventListener( 'keyup', onKeyUp );
			document.removeEventListener( 'pointerdown', onPointerDown );
			document.removeEventListener( 'pointerup', onPointerUp );
			document.removeEventListener( 'pointermove', onPointerMove );
			dom.removeEventListener( 'click', requestPointerLock );

			if ( document.pointerLockElement ) {

				document.exitPointerLock();

			}

			dispatch( events.stop, arguments );

			renderer.setAnimationLoop( null );

			// Cleanup physics
			if ( physicsWorld ) {

				physicsWorld.free();
				physicsWorld = null;

			}

			physicsObjects = [];
			characterController = null;
			characterBody = null;
			characterCollider = null;
			characterMesh = null;
			characterGroup = null;
			animationMixer = null;
			keys = {};

		};

		this.render = function ( time ) {

			dispatch( events.update, { time: time * 1000, delta: 0 } );

			renderer.render( scene, camera );

		};

		this.dispose = function () {

			renderer.dispose();

			camera = undefined;
			scene = undefined;

		};

		//

		function requestPointerLock() {

			dom.requestPointerLock();

		}

		function onKeyDown( event ) {

			keys[ event.code ] = true;
			dispatch( events.keydown, event );

		}

		function onKeyUp( event ) {

			keys[ event.code ] = false;
			dispatch( events.keyup, event );

		}

		var isMouseDown = false;

		function onPointerDown( event ) {

			isMouseDown = true;
			dispatch( events.pointerdown, event );

		}

		function onPointerUp( event ) {

			isMouseDown = false;
			dispatch( events.pointerup, event );

		}

		function onPointerMove( event ) {

			// Camera orbit: works with pointer lock OR mouse drag (left/right click)
			var hasPointerLock = document.pointerLockElement === dom || document.pointerLockElement === dom.parentElement;

			if ( hasPointerLock || isMouseDown ) {

				var mx = event.movementX || 0;
				var my = event.movementY || 0;

				cameraAngle -= mx * 0.003;
				cameraPitch += my * 0.002;
				// Clamp pitch to avoid flipping
				cameraPitch = Math.max( -0.5, Math.min( 1.2, cameraPitch ) );

			}

			dispatch( events.pointermove, event );

		}

	}

};

export { APP };
