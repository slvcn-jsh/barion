"""Build Barion's rigged, animated Bari GLB from the static source asset.

Run through Blender, not the system Python interpreter. The generated rig uses
rigid vertex weights because Bari is assembled from separate low-poly pieces.
That preserves the authored silhouette and avoids unreliable automatic weights.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path
from typing import Callable

import bpy
from mathutils import Vector


REQUIRED_MESHES = {
    "head_shell",
    "face",
    "ear_0",
    "ear_1",
    "cap_brim",
    "cap_top",
    "eye_white_left",
    "iris_left",
    "pupil_left",
    "sparkle_left",
    "eye_white_right",
    "iris_right",
    "pupil_right",
    "sparkle_right",
    "brow_0",
    "brow_1",
    "nose",
    "mouth",
    "tongue",
    "body_shell",
    "belly",
    "belly_tail",
    "chest_star",
    "tail",
    "arm_left",
    "cuff_left",
    "hand_left",
    "arm_right",
    "cuff_right",
    "hand_right",
    "leg_left",
    "leg_right",
    "boot_left",
    "boot_right",
    "toe_left",
    "toe_right",
}

MESH_BONE_MAP = {
    "head_shell": "head",
    "face": "head",
    "ear_0": "head",
    "ear_1": "head",
    "cap_brim": "head",
    "cap_top": "head",
    "eye_white_left": "leftEye",
    "iris_left": "leftEye",
    "pupil_left": "leftEye",
    "sparkle_left": "leftEye",
    "eye_white_right": "rightEye",
    "iris_right": "rightEye",
    "pupil_right": "rightEye",
    "sparkle_right": "rightEye",
    "brow_0": "leftBrow",
    "brow_1": "rightBrow",
    "nose": "head",
    "mouth": "mouth",
    "tongue": "mouth",
    "body_shell": "spine",
    "belly": "spine",
    "belly_tail": "spine",
    "chest_star": "spine",
    "tail": "tail",
    "arm_left": "leftArm",
    "cuff_left": "leftHand",
    "hand_left": "leftHand",
    "arm_right": "rightArm",
    "cuff_right": "rightHand",
    "hand_right": "rightHand",
    "leg_left": "leftLeg",
    "boot_left": "leftFoot",
    "toe_left": "leftFoot",
    "leg_right": "rightLeg",
    "boot_right": "rightFoot",
    "toe_right": "rightFoot",
}

CLIP_FRAMES = {
    "idle": 90,
    "blink": 12,
    "wave": 60,
    "thinking": 75,
    "explaining": 75,
    "celebrate": 60,
    "talk": 36,
    "encourage": 60,
    "offline": 30,
    "error": 45,
}

LEFT_EYE_SHAPE_OBJECTS = [
    "eye_white_left",
    "iris_left",
    "pupil_left",
    "sparkle_left",
]

RIGHT_EYE_SHAPE_OBJECTS = [
    "eye_white_right",
    "iris_right",
    "pupil_right",
    "sparkle_right",
]

MOUTH_SHAPE_OBJECT = "mouth"

EYE_BLINK_LEFT_KEY = "blinkLeft"
EYE_BLINK_RIGHT_KEY = "blinkRight"

MOUTH_VISAME_KEYS = ["visemeA", "visemeE", "visemeO"]



def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--blend-output", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--success-marker", required=True, type=Path)
    argv = []
    if "--" in __import__("sys").argv:
        argv = __import__("sys").argv[__import__("sys").argv.index("--") + 1 :]
    return parser.parse_args(argv)


def object_center(obj: bpy.types.Object) -> Vector:
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return sum(corners, Vector()) / len(corners)


def create_armature() -> bpy.types.Object:
    armature_data = bpy.data.armatures.new("BariRig")
    armature = bpy.data.objects.new("BariRig", armature_data)
    bpy.context.collection.objects.link(armature)
    armature.show_in_front = True
    armature["barionRigVersion"] = "1.0.0"
    armature["barionRigType"] = "rigid-segment"

    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    bones: dict[str, bpy.types.EditBone] = {}

    def add_bone(
        name: str,
        head: tuple[float, float, float],
        tail: tuple[float, float, float],
        parent: str | None = None,
        connected: bool = False,
    ) -> None:
        bone = armature_data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        if parent:
            bone.parent = bones[parent]
            bone.use_connect = connected
        bones[name] = bone

    add_bone("root", (0.0, 0.2, 0.0), (0.0, -0.55, 0.0))
    add_bone("spine", (0.0, -0.55, 0.0), (0.0, -2.55, 0.0), "root", True)
    add_bone("head", (0.0, -2.55, 0.0), (0.0, -3.75, 0.0), "spine", True)
    add_bone("leftArm", (-0.68, -1.95, 0.12), (-0.95, -1.48, 0.25), "spine")
    add_bone("leftHand", (-0.95, -1.48, 0.25), (-1.07, -1.27, 0.32), "leftArm", True)
    add_bone("rightArm", (0.70, -2.05, 0.12), (1.08, -2.49, 0.22), "spine")
    add_bone("rightHand", (1.08, -2.49, 0.22), (1.29, -2.72, 0.27), "rightArm", True)
    add_bone("leftLeg", (-0.34, -0.72, 0.02), (-0.42, -0.10, 0.05), "root")
    add_bone("leftFoot", (-0.42, -0.10, 0.05), (-0.48, 0.24, 0.22), "leftLeg", True)
    add_bone("rightLeg", (0.40, -0.72, 0.01), (0.56, -0.10, 0.04), "root")
    add_bone("rightFoot", (0.56, -0.10, 0.04), (0.70, 0.23, 0.20), "rightLeg", True)
    add_bone("leftEye", (-0.22, -3.18, 0.87), (-0.22, -3.18, 1.02), "head")
    add_bone("rightEye", (0.22, -3.18, 0.87), (0.22, -3.18, 1.02), "head")
    add_bone("leftBrow", (-0.25, -3.50, 0.74), (-0.25, -3.50, 0.87), "head")
    add_bone("rightBrow", (0.25, -3.50, 0.74), (0.25, -3.50, 0.87), "head")
    add_bone("mouth", (0.0, -2.80, 0.93), (0.0, -2.80, 1.06), "head")
    add_bone("tail", (0.0, -1.35, -0.86), (0.0, -1.35, -1.02), "spine")

    bpy.ops.object.mode_set(mode="OBJECT")
    return armature


def bind_meshes(armature: bpy.types.Object) -> None:
    for mesh_name, bone_name in MESH_BONE_MAP.items():
        obj = bpy.data.objects[mesh_name]
        obj.vertex_groups.clear()
        group = obj.vertex_groups.new(name=bone_name)
        group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")

        for modifier in tuple(obj.modifiers):
            if modifier.type == "ARMATURE":
                obj.modifiers.remove(modifier)
        modifier = obj.modifiers.new(name="BariRig", type="ARMATURE")
        modifier.object = armature
        modifier.use_vertex_groups = True
        world_matrix = obj.matrix_world.copy()
        obj.parent = armature
        obj.matrix_world = world_matrix


def add_scaled_shape(
    obj: bpy.types.Object,
    name: str,
    scale: tuple[float, float, float],
) -> None:
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis")
    center = object_center(obj)
    key = obj.shape_key_add(name=name)
    key.value = 0.0
    for point, vertex in zip(key.data, obj.data.vertices, strict=True):
        relative = vertex.co - center
        point.co = center + Vector(
            (relative.x * scale[0], relative.y * scale[1], relative.z * scale[2])
        )


def create_face_shapes() -> None:
    for side in ("left", "right"):
        shape_name = "blinkLeft" if side == "left" else "blinkRight"
        for prefix in ("eye_white", "iris", "pupil", "sparkle"):
            add_scaled_shape(bpy.data.objects[f"{prefix}_{side}"], shape_name, (1.0, 0.08, 1.0))

    mouth = bpy.data.objects["mouth"]
    add_scaled_shape(mouth, "smileClosed", (1.18, 0.72, 1.0))
    add_scaled_shape(mouth, "smileOpen", (1.10, 1.35, 1.0))
    add_scaled_shape(mouth, "visemeA", (0.95, 1.55, 1.0))
    add_scaled_shape(mouth, "visemeE", (1.25, 0.82, 1.0))
    add_scaled_shape(mouth, "visemeO", (0.76, 1.38, 1.0))


def reset_pose(armature: bpy.types.Object) -> None:
    for bone in armature.pose.bones:
        bone.rotation_mode = "XYZ"
        bone.location = (0.0, 0.0, 0.0)
        bone.rotation_euler = (0.0, 0.0, 0.0)
        bone.scale = (1.0, 1.0, 1.0)


def reset_shape_keys() -> None:
    for obj_name in [
        *LEFT_EYE_SHAPE_OBJECTS,
        *RIGHT_EYE_SHAPE_OBJECTS,
        MOUTH_SHAPE_OBJECT,
    ]:
        obj = bpy.data.objects.get(obj_name)
        if not obj or obj.data.shape_keys is None:
            continue
        for kb in obj.data.shape_keys.key_blocks:
            if kb.name == "Basis":
                continue
            kb.value = 0.0


def key_bone(
    armature: bpy.types.Object,
    bone_name: str,
    frame: int,
    *,
    location: tuple[float, float, float] | None = None,
    rotation: tuple[float, float, float] | None = None,
    scale: tuple[float, float, float] | None = None,
) -> None:
    bone = armature.pose.bones[bone_name]
    if location is not None:
        bone.location = location
        bone.keyframe_insert("location", frame=frame, group=bone_name)
    if rotation is not None:
        bone.rotation_euler = rotation
        bone.keyframe_insert("rotation_euler", frame=frame, group=bone_name)
    if scale is not None:
        bone.scale = scale
        bone.keyframe_insert("scale", frame=frame, group=bone_name)


def key_shape_value(obj_name: str, shape_key_name: str, frame: int, value: float) -> None:
    obj = bpy.data.objects[obj_name]
    if obj.data.shape_keys is None:
        raise RuntimeError(f"Object {obj_name} has no shape keys")
    kb = obj.data.shape_keys.key_blocks[shape_key_name]
    kb.value = value
    kb.keyframe_insert(data_path="value", frame=frame)


def key_mouth_pose(
    frame: int,
    *,
    smile_open: float = 0.0,
    viseme_a: float = 0.0,
    viseme_e: float = 0.0,
    viseme_o: float = 0.0,
) -> None:
    """Key a complete mouth pose so visemes never leak into the next phoneme."""
    values = {
        "smileOpen": smile_open,
        "visemeA": viseme_a,
        "visemeE": viseme_e,
        "visemeO": viseme_o,
    }
    for shape_key_name, value in values.items():
        key_shape_value(MOUTH_SHAPE_OBJECT, shape_key_name, frame, value)


def build_action(
    armature: bpy.types.Object,
    name: str,
    author: Callable[[], None],
) -> bpy.types.Action:
    reset_pose(armature)
    reset_shape_keys()
    action = bpy.data.actions.new(name=name)
    action.use_fake_user = True
    armature.animation_data.action = action
    author()
    action.use_frame_range = True
    action.frame_start = 1
    action.frame_end = CLIP_FRAMES[name]
    action.use_cyclic = name in {"idle", "blink", "thinking", "explaining", "talk", "offline"}
    return action


def build_mouth_action(name: str, author: Callable[[], None]) -> bpy.types.Action:
    mouth = bpy.data.objects[MOUTH_SHAPE_OBJECT]
    shape_keys = mouth.data.shape_keys
    if shape_keys is None:
        raise RuntimeError("Mouth shape keys are missing")

    reset_shape_keys()
    shape_keys.animation_data_create()
    action = bpy.data.actions.new(name=name)
    action.use_fake_user = True
    shape_keys.animation_data.action = action
    author()
    action.use_frame_range = True
    action.frame_start = 1
    action.frame_end = CLIP_FRAMES[name]
    action.use_cyclic = True
    return action


def create_actions(armature: bpy.types.Object) -> None:
    armature.animation_data_create()
    def idle() -> None:
        key_bone(armature, "spine", 1, rotation=(0.0, 0.0, -0.018), scale=(1.0, 1.0, 1.0))
        key_bone(armature, "spine", 45, rotation=(0.0, 0.0, 0.018), scale=(1.012, 1.0, 1.012))
        key_bone(armature, "spine", 90, rotation=(0.0, 0.0, -0.018), scale=(1.0, 1.0, 1.0))
        key_bone(armature, "head", 1, rotation=(0.0, 0.0, 0.012))
        key_bone(armature, "head", 45, rotation=(0.0, 0.0, -0.012))
        key_bone(armature, "head", 90, rotation=(0.0, 0.0, 0.012))

    def blink() -> None:
        for eye in ("leftEye", "rightEye"):
            key_bone(armature, eye, 1, scale=(1.0, 1.0, 1.0))
            key_bone(armature, eye, 5, scale=(1.0, 1.0, 0.06))
            key_bone(armature, eye, 8, scale=(1.0, 1.0, 0.06))
            key_bone(armature, eye, 12, scale=(1.0, 1.0, 1.0))

    def wave() -> None:
        key_bone(armature, "rightArm", 1, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "rightArm", 15, rotation=(0.0, 0.0, -0.10))
        key_bone(armature, "rightArm", 50, rotation=(0.0, 0.0, -0.10))
        key_bone(armature, "rightArm", 60, rotation=(0.0, 0.0, 0.0))
        for frame, angle in ((1, 0.0), (15, -0.45), (25, 0.35), (35, -0.45), (45, 0.35), (52, 0.0), (60, 0.0)):
            key_bone(armature, "rightHand", frame, rotation=(0.0, 0.0, angle))
        key_bone(armature, "head", 1, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "head", 30, rotation=(0.05, 0.0, 0.05))
        key_bone(armature, "head", 60, rotation=(0.0, 0.0, 0.0))

    def thinking() -> None:
        key_bone(armature, "rightArm", 1, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "rightArm", 24, rotation=(0.0, 0.0, -0.48))
        key_bone(armature, "rightArm", 52, rotation=(0.0, 0.0, -0.48))
        key_bone(armature, "rightArm", 75, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "rightHand", 1, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "rightHand", 24, rotation=(0.0, 0.0, 0.35))
        key_bone(armature, "rightHand", 52, rotation=(0.0, 0.0, 0.35))
        key_bone(armature, "rightHand", 75, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "head", 1, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "head", 24, rotation=(0.08, 0.0, -0.08))
        key_bone(armature, "head", 48, rotation=(0.11, 0.0, -0.035))
        key_bone(armature, "head", 75, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "leftBrow", 1, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "leftBrow", 24, rotation=(0.0, 0.0, -0.18))
        key_bone(armature, "leftBrow", 48, rotation=(0.0, 0.0, -0.12))
        key_bone(armature, "leftBrow", 75, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "rightBrow", 1, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "rightBrow", 24, rotation=(0.0, 0.0, 0.10))
        key_bone(armature, "rightBrow", 48, rotation=(0.0, 0.0, 0.06))
        key_bone(armature, "rightBrow", 75, rotation=(0.0, 0.0, 0.0))

    def explaining() -> None:
        for frame, angle in ((1, 0.0), (18, 0.52), (40, 0.26), (60, 0.48), (75, 0.0)):
            key_bone(armature, "leftArm", frame, rotation=(0.0, 0.0, angle))
        for frame, angle in ((1, 0.0), (20, 0.20), (42, -0.10), (62, 0.16), (75, 0.0)):
            key_bone(armature, "rightHand", frame, rotation=(0.0, 0.0, angle))
        key_bone(armature, "head", 1, rotation=(0.0, 0.0, -0.025))
        key_bone(armature, "head", 38, rotation=(0.035, 0.0, 0.025))
        key_bone(armature, "head", 75, rotation=(0.0, 0.0, -0.025))

    def celebrate() -> None:
        key_bone(armature, "leftArm", 1, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "leftArm", 18, rotation=(0.0, 0.0, 1.45))
        key_bone(armature, "leftArm", 46, rotation=(0.0, 0.0, 1.45))
        key_bone(armature, "leftArm", 60, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "rightArm", 1, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "rightArm", 18, rotation=(0.0, 0.0, -0.32))
        key_bone(armature, "rightArm", 46, rotation=(0.0, 0.0, -0.32))
        key_bone(armature, "rightArm", 60, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "root", 1, location=(0.0, 0.0, 0.0))
        key_bone(armature, "root", 22, location=(0.0, -0.12, 0.0))
        key_bone(armature, "root", 38, location=(0.0, 0.0, 0.0))
        key_bone(armature, "root", 48, location=(0.0, -0.07, 0.0))
        key_bone(armature, "root", 60, location=(0.0, 0.0, 0.0))

        key_bone(armature, "mouth", 1, scale=(1.0, 1.0, 1.0))
        key_bone(armature, "mouth", 18, scale=(1.12, 1.0, 1.42))
        key_bone(armature, "mouth", 46, scale=(1.12, 1.0, 1.42))
        key_bone(armature, "mouth", 60, scale=(1.0, 1.0, 1.0))

    def talk() -> None:
        # Complete phoneme poses create a smooth, leak-free speaking loop.
        key_mouth_pose(1)
        key_mouth_pose(5, smile_open=0.12, viseme_a=0.78)
        key_mouth_pose(10, viseme_e=0.68)
        key_mouth_pose(15, viseme_o=0.82)
        key_mouth_pose(19, smile_open=0.20)
        key_mouth_pose(23, viseme_a=0.62)
        key_mouth_pose(28, viseme_e=0.76)
        key_mouth_pose(32, smile_open=0.10, viseme_o=0.68)
        key_mouth_pose(36)

    def encourage() -> None:
        key_bone(armature, "head", 1, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "head", 18, rotation=(0.12, 0.0, 0.06))
        key_bone(armature, "head", 38, rotation=(-0.035, 0.0, -0.03))
        key_bone(armature, "head", 60, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "leftArm", 1, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "leftArm", 24, rotation=(0.0, 0.0, 0.34))
        key_bone(armature, "leftArm", 46, rotation=(0.0, 0.0, 0.34))
        key_bone(armature, "leftArm", 60, rotation=(0.0, 0.0, 0.0))

        key_bone(armature, "mouth", 1, scale=(1.0, 1.0, 1.0))
        key_bone(armature, "mouth", 18, scale=(1.08, 1.0, 1.20))
        key_bone(armature, "mouth", 38, scale=(1.06, 1.0, 1.15))
        key_bone(armature, "mouth", 60, scale=(1.0, 1.0, 1.0))

        # Keep neutral blink state for eyes (blink morph triggered by blink clip).

    def offline() -> None:
        key_bone(armature, "head", 1, rotation=(0.06, 0.0, 0.0))
        key_bone(armature, "head", 30, rotation=(0.06, 0.0, 0.0))

    def error() -> None:
        key_bone(armature, "head", 1, rotation=(0.0, 0.0, 0.0))
        key_bone(armature, "head", 15, rotation=(0.0, 0.0, -0.09))
        key_bone(armature, "head", 30, rotation=(0.0, 0.0, 0.09))
        key_bone(armature, "head", 45, rotation=(0.0, 0.0, 0.0))

    authors = {
        "idle": idle,
        "blink": blink,
        "wave": wave,
        "thinking": thinking,
        "explaining": explaining,
        "celebrate": celebrate,
        "encourage": encourage,
        "offline": offline,
        "error": error,
    }
    for name, author in authors.items():
        build_action(armature, name, author)
    build_mouth_action("talk", talk)

    armature.animation_data.action = None
    reset_pose(armature)


def load_glb_json(path: Path) -> dict:
    with path.open("rb") as stream:
        magic, version, _length = struct.unpack("<4sII", stream.read(12))
        if magic != b"glTF" or version != 2:
            raise RuntimeError(f"Unexpected GLB header in {path}")
        chunk_length, chunk_type = struct.unpack("<II", stream.read(8))
        if chunk_type != 0x4E4F534A:
            raise RuntimeError(f"First GLB chunk is not JSON in {path}")
        return json.loads(stream.read(chunk_length).decode("utf-8").rstrip("\x00 \t\r\n"))


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def export_and_validate(args: argparse.Namespace, armature: bpy.types.Object) -> None:
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.blend_output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)

    bpy.context.scene.render.fps = 30
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = max(CLIP_FRAMES.values())
    bpy.context.scene["barionAssetStatus"] = "production-rig-v1"
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(args.blend_output))

    bpy.ops.export_scene.gltf(
        filepath=str(args.output),
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_merge_animation="ACTION",
        export_morph=True,
        export_morph_normal=False,
        export_morph_tangent=False,
        export_normals=False,
        export_skins=True,
        export_all_influences=False,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=False,
        export_yup=True,
    )

    document = load_glb_json(args.output)
    animation_names = sorted(animation.get("name", "") for animation in document.get("animations", []))
    expected_animations = sorted(CLIP_FRAMES)
    missing_animations = sorted(set(expected_animations) - set(animation_names))
    if missing_animations:
        raise RuntimeError(f"Export missed animation clips: {missing_animations}")
    if not document.get("skins"):
        raise RuntimeError("Export contains no skin")

    animation_channels = {
        animation.get("name", ""): sorted({
            channel.get("target", {}).get("path", "")
            for channel in animation.get("channels", [])
        })
        for animation in document.get("animations", [])
    }
    if "weights" not in animation_channels.get("talk", []):
        raise RuntimeError("Talk animation contains no facial morph channels")

    morph_target_count = sum(
        len(primitive.get("targets", []))
        for mesh in document.get("meshes", [])
        for primitive in mesh.get("primitives", [])
    )
    if morph_target_count < 10:
        raise RuntimeError(f"Expected facial morph targets, found {morph_target_count}")

    report = {
        "asset": args.output.name,
        "status": "validated",
        "sourceSha256": file_sha256(args.input),
        "outputSha256": file_sha256(args.output),
        "outputBytes": args.output.stat().st_size,
        "meshCount": len(document.get("meshes", [])),
        "nodeCount": len(document.get("nodes", [])),
        "skinCount": len(document.get("skins", [])),
        "jointCount": len(document["skins"][0].get("joints", [])),
        "morphTargetCount": morph_target_count,
        "animations": animation_names,
        "animationChannels": animation_channels,
        "requiredAnimations": expected_animations,
    }
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    args.success_marker.parent.mkdir(parents=True, exist_ok=True)
    args.success_marker.write_text("BARI_BUILD_OK\n", encoding="utf-8")
    print("BARI_BUILD_REPORT", json.dumps(report, sort_keys=True))


def main() -> None:
    args = parse_args()
    args.input = args.input.resolve()
    args.output = args.output.resolve()
    args.blend_output = args.blend_output.resolve()
    args.report = args.report.resolve()
    args.success_marker = args.success_marker.resolve()
    if not args.input.is_file():
        raise FileNotFoundError(args.input)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.input))

    available_meshes = {obj.name for obj in bpy.context.scene.objects if obj.type == "MESH"}
    missing_meshes = sorted(REQUIRED_MESHES - available_meshes)
    if missing_meshes:
        raise RuntimeError(f"Static Bari source is missing meshes: {missing_meshes}")

    armature = create_armature()
    bind_meshes(armature)
    create_face_shapes()
    create_actions(armature)
    export_and_validate(args, armature)


if __name__ == "__main__":
    main()
