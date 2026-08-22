import { useState } from 'react';
import { Select, InputNumber, Slider } from 'antd';
import { DeleteOutlined, PlusOutlined, EyeOutlined } from '@ant-design/icons';
import { usePrevizStore } from './previzStore';
import { CAMERA_MOVE_LABELS, TARGET_MOVE_TYPES } from './cameraRig';
import type { PrevizCameraMoveType } from './types';

const MOVE_TYPE_OPTIONS = (Object.keys(CAMERA_MOVE_LABELS) as PrevizCameraMoveType[]).map(
  (type) => ({ value: type, label: CAMERA_MOVE_LABELS[type] })
);

// 右侧相机面板：相机列表 + 选中相机的运镜参数编辑
export function CameraPanel() {
  const cameras = usePrevizStore((s) => s.cameras);
  const characters = usePrevizStore((s) => s.characters);
  const selectedCameraId = usePrevizStore((s) => s.selectedCameraId);
  const previewCameraId = usePrevizStore((s) => s.previewCameraId);
  const duration = usePrevizStore((s) => s.duration);
  const addCamera = usePrevizStore((s) => s.addCamera);
  const removeCamera = usePrevizStore((s) => s.removeCamera);
  const updateCamera = usePrevizStore((s) => s.updateCamera);
  const updateCameraMove = usePrevizStore((s) => s.updateCameraMove);
  const setSelectedCamera = usePrevizStore((s) => s.setSelectedCamera);
  const setPreviewCamera = usePrevizStore((s) => s.setPreviewCamera);

  // 改名状态（双击名称进入编辑）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const commitRename = () => {
    if (editingId && editingName.trim()) {
      updateCamera(editingId, { name: editingName.trim() });
    }
    setEditingId(null);
  };

  const selectedCam = cameras.find((c) => c.id === selectedCameraId) ?? null;
  // 该运镜类型是否需要选择跟随角色
  const needsTarget = selectedCam ? TARGET_MOVE_TYPES.includes(selectedCam.move.type) : false;

  return (
    <div className="h-full flex flex-col">
      {/* 添加相机 */}
      <div className="p-3 border-b border-gray-100">
        <button
          className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-xs text-gray-600 bg-gray-50 hover:bg-blue-50 hover:text-blue-600 rounded transition-colors cursor-pointer"
          onClick={addCamera}
        >
          <PlusOutlined className="text-[10px]" />
          添加相机
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 相机列表 */}
        <div className="p-2">
          {cameras.length === 0 ? (
            <div className="text-xs text-gray-300 text-center py-6">暂无相机，点击上方添加</div>
          ) : (
            cameras.map((cam) => (
              <div
                key={cam.id}
                className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-xs ${
                  selectedCameraId === cam.id
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
                onClick={() => setSelectedCamera(cam.id)}
                onDoubleClick={() => {
                  setEditingId(cam.id);
                  setEditingName(cam.name);
                }}
              >
                {editingId === cam.id ? (
                  <input
                    className="flex-1 min-w-0 bg-white border border-gray-300 rounded px-1 py-0.5 text-xs text-gray-800 outline-none focus:border-blue-400"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <>
                    <span className="flex-1 truncate" title="双击改名">
                      {cam.name}
                    </span>
                    <button
                      className={`shrink-0 cursor-pointer transition-colors ${
                        previewCameraId === cam.id
                          ? 'text-blue-500'
                          : 'text-gray-400 hover:text-blue-500'
                      }`}
                      title={previewCameraId === cam.id ? '退出相机视角' : '预览相机视角'}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewCamera(previewCameraId === cam.id ? null : cam.id);
                      }}
                    >
                      <EyeOutlined className="text-[12px]" />
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity cursor-pointer shrink-0"
                      title="删除相机"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCamera(cam.id);
                      }}
                    >
                      <DeleteOutlined className="text-[11px]" />
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {/* 选中相机的参数编辑 */}
        {selectedCam && (
          <div className="px-3 py-2 border-t border-gray-100 flex flex-col gap-2.5">
            <div className="text-xs text-gray-400 font-medium">运镜设置</div>

            {/* 运镜类型 */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-14 shrink-0">类型</span>
              <Select
                size="small"
                className="flex-1"
                value={selectedCam.move.type}
                options={MOVE_TYPE_OPTIONS}
                onChange={(type) => updateCameraMove(selectedCam.id, { type })}
              />
            </div>

            {/* 跟随目标 */}
            {needsTarget && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500 w-14 shrink-0">跟随目标</span>
                <Select
                  size="small"
                  className="flex-1"
                  placeholder="选择角色"
                  value={selectedCam.move.targetCharacterId}
                  options={characters.map((c) => ({ value: c.id, label: c.name }))}
                  onChange={(targetCharacterId) =>
                    updateCameraMove(selectedCam.id, { targetCharacterId })
                  }
                />
              </div>
            )}

            {/* 开始时间 / 运镜时长 */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-14 shrink-0">开始(s)</span>
              <InputNumber
                size="small"
                className="flex-1"
                min={0}
                max={duration}
                step={0.1}
                value={selectedCam.move.start}
                onChange={(v) => {
                  if (typeof v === 'number') updateCameraMove(selectedCam.id, { start: v });
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-14 shrink-0">时长(s)</span>
              <InputNumber
                size="small"
                className="flex-1"
                min={0.1}
                max={duration}
                step={0.1}
                value={selectedCam.move.duration}
                onChange={(v) => {
                  if (typeof v === 'number') {
                    updateCameraMove(selectedCam.id, { duration: Math.min(v, duration) });
                  }
                }}
              />
            </div>

            {/* FOV */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 w-14 shrink-0">FOV</span>
              <Slider
                className="flex-1"
                min={10}
                max={120}
                value={selectedCam.fov}
                onChange={(fov) => updateCamera(selectedCam.id, { fov })}
              />
              <span className="text-[11px] text-gray-400 w-6 text-right">{selectedCam.fov}°</span>
            </div>

            <div className="text-[10px] text-gray-300 leading-relaxed">
              选中相机后，场景中蓝色点为起始机位、绿色点为结束机位，点击后可用 gizmo 拖动
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
