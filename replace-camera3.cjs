const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const uiPreviewDef = `function CameraUIPreview({ cameraVideoRef }: any) {
  const uiPreviewRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (uiPreviewRef.current && cameraVideoRef.current?.srcObject) {
       uiPreviewRef.current.srcObject = cameraVideoRef.current.srcObject;
    }
  }, [cameraVideoRef, cameraVideoRef.current?.srcObject]);
  return (
    <div className="w-full aspect-video bg-black border border-zinc-800 rounded overflow-hidden mt-3 relative">
       <div className="absolute top-2 right-2 text-[9px] font-bold tracking-widest uppercase bg-orange-600 px-2 py-0.5 rounded text-black z-10">AI TRACKING LIVE</div>
       <video ref={uiPreviewRef} autoPlay playsInline muted className="w-full h-full object-cover origin-center scale-x-[-1]" />
    </div>
  );
}

function VJPanel({ vjState, updateVjSetting, updateLayer, addLayer, removeLayer, cameraVideoRef, mediaVideoRef }: any) {`;

code = code.replace(`function VJPanel({ vjState, updateVjSetting, updateLayer, addLayer, removeLayer, cameraVideoRef, mediaVideoRef }: any) {`, uiPreviewDef);

const tso1 = code.indexOf(`{vjState.isCameraActive && (`);
const tso2 = code.indexOf(`</>`, tso1);

const camUILogic = `{vjState.isCameraActive && (
                      <>
                        <CameraUIPreview cameraVideoRef={cameraVideoRef} />
                        <div className="flex flex-col gap-3 bg-zinc-950 p-4 border border-zinc-800 mt-2">
                          <div className="text-[10px] text-zinc-500 font-mono text-center">
                             Using MediaPipe Face & Hand Landmarker to project 3D wireframes onto surfaces.
                          </div>
                          {/* Removing older filter options as we use Mediapipe now */}
                        </div>
                      </>
                    )}
                  `;

code = code.substring(0, tso1) + camUILogic + code.substring(tso2);
fs.writeFileSync('src/App.tsx', code);
