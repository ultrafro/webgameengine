import * as THREE from 'three';
import { AddObjectCommand } from './commands/AddObjectCommand.js';
import { SetPositionCommand } from './commands/SetPositionCommand.js';
import { SetRotationCommand } from './commands/SetRotationCommand.js';
import { SetScaleCommand } from './commands/SetScaleCommand.js';
import { RemoveObjectCommand } from './commands/RemoveObjectCommand.js';
import { AddScriptCommand } from './commands/AddScriptCommand.js';
import { SetMaterialColorCommand } from './commands/SetMaterialColorCommand.js';
import { SetMaterialValueCommand } from './commands/SetMaterialValueCommand.js';

function Bridge( editor ) {

	function handleMessage( event ) {

		const data = event.data;

		if ( ! data || ! data.type || data.source !== 'webgameengine' ) return;

		// Forward key events from parent page to document
		if ( data.type === 'keyEvent' ) {

			document.dispatchEvent( new KeyboardEvent( data.eventType, {
				code: data.code,
				key: data.key,
				bubbles: true
			} ) );
			return;

		}

		let response = { id: data.id, type: 'response', success: true };

		try {

			switch ( data.type ) {

				case 'getScene':
					response.data = editor.toJSON();
					break;

				case 'addObject': {
					const obj = createObject( data.params );
					if ( obj ) {
						editor.execute( new AddObjectCommand( editor, obj ) );
						response.data = { uuid: obj.uuid, name: obj.name };
					}
					break;
				}

				case 'removeObject': {
					const obj = findObject( data.params );
					if ( obj ) {
						editor.execute( new RemoveObjectCommand( editor, obj ) );
					}
					break;
				}

				case 'setPosition': {
					const obj = findObject( data.params );
					if ( obj ) {
						const p = data.params.position;
						editor.execute( new SetPositionCommand( editor, obj, new THREE.Vector3( p.x, p.y, p.z ) ) );
					}
					break;
				}

				case 'setRotation': {
					const obj = findObject( data.params );
					if ( obj ) {
						const r = data.params.rotation;
						editor.execute( new SetRotationCommand( editor, obj, new THREE.Euler( r.x, r.y, r.z ) ) );
					}
					break;
				}

				case 'setScale': {
					const obj = findObject( data.params );
					if ( obj ) {
						const s = data.params.scale;
						editor.execute( new SetScaleCommand( editor, obj, new THREE.Vector3( s.x, s.y, s.z ) ) );
					}
					break;
				}

				case 'setMaterialColor': {
					const obj = findObject( data.params );
					if ( obj && obj.material ) {
						editor.execute( new SetMaterialColorCommand( editor, obj, 'color', data.params.color ) );
					}
					break;
				}

				case 'setUserData': {
					const obj = findObject( data.params );
					if ( obj ) {
						obj.userData = Object.assign( obj.userData || {}, data.params.userData );
						editor.signals.objectChanged.dispatch( obj );
					}
					break;
				}

				case 'addScript': {
					const obj = findObject( data.params );
					if ( obj ) {
						const script = { name: data.params.scriptName || 'script', source: data.params.source };
						editor.execute( new AddScriptCommand( editor, obj, script ) );
					}
					break;
				}

				case 'select': {
					const obj = findObject( data.params );
					if ( obj ) editor.select( obj );
					break;
				}

				case 'play':
					editor.signals.startPlayer.dispatch();
					break;

				case 'stop':
					editor.signals.stopPlayer.dispatch();
					break;

				case 'clear':
					editor.clear();
					break;

				case 'loadScene': {
					editor.clear();
					editor.fromJSON( data.params.json );
					break;
				}

				case 'listObjects': {
					const objects = [];
					editor.scene.traverse( function( child ) {
						objects.push({
							uuid: child.uuid,
							name: child.name,
							type: child.type,
							position: child.position.toArray(),
							userData: child.userData
						});
					});
					response.data = objects;
					break;
				}

				case 'spawnCharacter': {
					const p = data.params;
					// Create a group to hold the character parts
					const group = new THREE.Group();
					group.name = p.name || 'Player';
					group.position.set(
						p.position ? p.position.x : 0,
						p.position ? p.position.y : 1.5,
						p.position ? p.position.z : 0
					);

					// Body (capsule)
					const bodyGeo = new THREE.CapsuleGeometry( 0.3, 0.8, 4, 16 );
					const bodyMat = new THREE.MeshStandardMaterial( { color: p.color || 0x4488ff } );
					const body = new THREE.Mesh( bodyGeo, bodyMat );
					body.name = 'PlayerBody';
					body.castShadow = true;
					body.userData = {
						physics: {
							bodyType: 'kinematicCharacter',
							collider: 'capsule',
							radius: 0.3,
							halfHeight: 0.4
						},
						isPlayer: true
					};
					group.add( body );

					// Head (sphere)
					const headGeo = new THREE.SphereGeometry( 0.22, 16, 12 );
					const headMat = new THREE.MeshStandardMaterial( { color: p.headColor || 0x66aaff } );
					const head = new THREE.Mesh( headGeo, headMat );
					head.name = 'PlayerHead';
					head.position.set( 0, 0.65, 0 );
					head.castShadow = true;
					group.add( head );

					// Eyes
					const eyeGeo = new THREE.SphereGeometry( 0.05, 8, 6 );
					const eyeMat = new THREE.MeshStandardMaterial( { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.3 } );
					const leftEye = new THREE.Mesh( eyeGeo, eyeMat );
					leftEye.name = 'LeftEye';
					leftEye.position.set( -0.08, 0.68, -0.18 );
					group.add( leftEye );

					const rightEye = new THREE.Mesh( eyeGeo, eyeMat.clone() );
					rightEye.name = 'RightEye';
					rightEye.position.set( 0.08, 0.68, -0.18 );
					group.add( rightEye );

					// Pupils
					const pupilGeo = new THREE.SphereGeometry( 0.025, 8, 6 );
					const pupilMat = new THREE.MeshStandardMaterial( { color: 0x111111 } );
					const leftPupil = new THREE.Mesh( pupilGeo, pupilMat );
					leftPupil.position.set( -0.08, 0.68, -0.22 );
					group.add( leftPupil );

					const rightPupil = new THREE.Mesh( pupilGeo, pupilMat.clone() );
					rightPupil.position.set( 0.08, 0.68, -0.22 );
					group.add( rightPupil );

					editor.execute( new AddObjectCommand( editor, group ) );
					response.data = { uuid: group.uuid, name: group.name };
					break;
				}

				default:
					response.success = false;
					response.error = 'Unknown command: ' + data.type;
			}

		} catch ( e ) {

			response.success = false;
			response.error = e.message;

		}

		window.parent.postMessage( response, '*' );

	}

	function findObject( params ) {

		if ( params.uuid ) return editor.scene.getObjectByProperty( 'uuid', params.uuid, true );
		if ( params.name ) return editor.scene.getObjectByName( params.name, true );
		return null;

	}

	function getDefaultPhysics( type, params ) {

		switch ( type ) {

			case 'box':
				return { bodyType: 'dynamic', collider: 'cuboid', friction: 0.6 };

			case 'sphere':
				return { bodyType: 'dynamic', collider: 'sphere', radius: params.radius || 1, friction: 0.4, restitution: 0.3 };

			case 'cylinder':
				return { bodyType: 'dynamic', collider: 'cuboid', friction: 0.5 };

			case 'capsule':
				return { bodyType: 'dynamic', collider: 'capsule', radius: params.radius || 0.5, halfHeight: ( params.length || 1 ) / 2, friction: 0.5 };

			case 'plane': {
				const w = params.width || 10;
				const h = params.height || 10;
				return { bodyType: 'fixed', collider: 'cuboid', hx: w / 2, hy: 0.05, hz: h / 2, friction: 0.8 };
			}

			default:
				return { bodyType: 'dynamic', collider: 'cuboid', friction: 0.5 };

		}

	}

	function createObject( params ) {

		const type = params.objectType || 'box';
		let geometry, material, mesh;

		material = new THREE.MeshStandardMaterial();
		if ( params.color ) material.color.set( params.color );

		switch ( type ) {

			case 'box':
				geometry = new THREE.BoxGeometry(
					params.width || 1, params.height || 1, params.depth || 1
				);
				break;

			case 'sphere':
				geometry = new THREE.SphereGeometry( params.radius || 1, 32, 16 );
				break;

			case 'cylinder':
				geometry = new THREE.CylinderGeometry(
					params.radiusTop || 1, params.radiusBottom || 1, params.height || 1, 32
				);
				break;

			case 'capsule':
				geometry = new THREE.CapsuleGeometry(
					params.radius || 0.5, params.length || 1, 4, 8
				);
				break;

			case 'plane': {
				geometry = new THREE.PlaneGeometry( params.width || 10, params.height || 10 );
				material.side = THREE.DoubleSide;
				mesh = new THREE.Mesh( geometry, material );
				mesh.name = params.name || 'Plane';
				mesh.rotation.x = -Math.PI / 2; // Face up
				if ( params.position ) {
					mesh.position.set( params.position.x, params.position.y, params.position.z );
				}
				if ( params.receiveShadow ) mesh.receiveShadow = true;
				if ( params.castShadow ) mesh.castShadow = true;
				mesh.userData = params.userData || {};
				if ( ! mesh.userData.physics ) {
					mesh.userData.physics = getDefaultPhysics( 'plane', params );
				}
				return mesh;
			}

			case 'directionalLight': {
				const light = new THREE.DirectionalLight( params.color || 0xffffff, params.intensity || 1 );
				light.name = params.name || 'DirectionalLight';
				light.position.set(
					params.position ? params.position.x : 5,
					params.position ? params.position.y : 10,
					params.position ? params.position.z : 7.5
				);
				return light;
			}

			case 'ambientLight': {
				const light = new THREE.AmbientLight( params.color || 0x404040, params.intensity || 1 );
				light.name = params.name || 'AmbientLight';
				return light;
			}

			case 'hemisphereLight': {
				const light = new THREE.HemisphereLight(
					params.skyColor || 0x87ceeb,
					params.groundColor || 0x362907,
					params.intensity || 1
				);
				light.name = params.name || 'HemisphereLight';
				light.position.set( 0, 10, 0 );
				return light;
			}

			case 'group': {
				const group = new THREE.Group();
				group.name = params.name || 'Group';
				if ( params.position ) {
					group.position.set( params.position.x, params.position.y, params.position.z );
				}
				if ( params.userData ) {
					group.userData = params.userData;
				}
				return group;
			}

			default:
				geometry = new THREE.BoxGeometry( 1, 1, 1 );
		}

		mesh = new THREE.Mesh( geometry, material );
		mesh.name = params.name || type.charAt( 0 ).toUpperCase() + type.slice( 1 );

		if ( params.position ) {
			mesh.position.set( params.position.x, params.position.y, params.position.z );
		}

		if ( params.rotation ) {
			mesh.rotation.set( params.rotation.x, params.rotation.y, params.rotation.z );
		}

		if ( params.userData ) {
			mesh.userData = params.userData;
		}

		if ( params.receiveShadow ) mesh.receiveShadow = true;
		if ( params.castShadow ) mesh.castShadow = true;

		// Add default physics if not already set
		if ( ! mesh.userData.physics ) {

			const defaultPhysics = getDefaultPhysics( type, params );
			if ( defaultPhysics ) {
				mesh.userData.physics = defaultPhysics;
			}

		}

		return mesh;

	}

	// Auto-add default physics to objects added via the editor UI
	editor.signals.objectAdded.add( function ( object ) {

		if ( ! object ) return;

		// Skip lights, cameras, helpers
		if ( object.isLight || object.isCamera ) return;

		// If it's a group, check if any child already has physics (e.g. character group)
		// If so, skip — it's already been configured
		let hasPhysicsChild = false;
		object.traverse( function ( child ) {
			if ( child.userData && child.userData.physics ) hasPhysicsChild = true;
		} );
		if ( hasPhysicsChild ) return;

		// For top-level meshes only (not children of groups)
		if ( object.isMesh && ( ! object.userData || ! object.userData.physics ) ) {

			if ( ! object.userData ) object.userData = {};

			let physicsType = 'box';
			if ( object.geometry ) {

				const geoType = object.geometry.type;
				if ( geoType.includes( 'Sphere' ) ) physicsType = 'sphere';
				else if ( geoType.includes( 'Cylinder' ) ) physicsType = 'cylinder';
				else if ( geoType.includes( 'Capsule' ) ) physicsType = 'capsule';
				else if ( geoType.includes( 'Plane' ) ) physicsType = 'plane';

			}

			object.userData.physics = getDefaultPhysics( physicsType, {} );

		}

	} );

	// Notify parent when editor state changes
	function notifyParent( type, data ) {

		window.parent.postMessage( { type: type, source: 'editor', data: data }, '*' );

	}

	editor.signals.objectSelected.add( function ( object ) {

		if ( object ) {
			notifyParent( 'objectSelected', {
				uuid: object.uuid,
				name: object.name,
				type: object.type,
				position: object.position.toArray(),
				userData: object.userData
			});
		}

	});

	editor.signals.sceneGraphChanged.add( function () {

		notifyParent( 'sceneChanged', {} );

	});

	window.addEventListener( 'message', handleMessage );

	console.log( 'Bridge: postMessage bridge initialized' );

}

export { Bridge };
