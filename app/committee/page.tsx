export default function CommitteePage() {
  return (
    <main style={{ width: "100vw", height: "100vh", margin: 0, padding: 0, overflow: "hidden", background: "#02060d" }}>
      <iframe
        src="/committee-room-3d.html"
        title="AIC 3D Committee Room"
        style={{ width: "100%", height: "100%", border: 0, display: "block" }}
        allow="autoplay; microphone"
      />
    </main>
  );
}
