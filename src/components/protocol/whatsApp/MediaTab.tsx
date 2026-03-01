import ErrorMsg from "./ErrorMsg";
import LoadingSpinner from "./LoadingSpinner";

const MediaTab: React.FC<{ wa: ReturnType<typeof useWhatsApp> }> = ({ wa }) => {
  const [uploadPath, setUploadPath] = useState("");
  const [uploadMime, setUploadMime] = useState("");
  const [lastMediaId, setLastMediaId] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");

  const [downloadId, setDownloadId] = useState("");
  const [downloaded, setDownloaded] = useState<{ data: string; mime: string } | null>(null);

  const handleUpload = async () => {
    const id = await wa.uploadMediaFile.execute(uploadPath, uploadMime);
    if (id) setLastMediaId(id);
  };

  const handleGetUrl = async () => {
    const url = await wa.getMediaUrl.execute(lastMediaId || downloadId);
    if (url) setMediaUrl(url);
  };

  const handleDownload = async () => {
    const result = await wa.downloadMedia.execute(downloadId);
    if (result) setDownloaded({ data: result[0], mime: result[1] });
  };

  const handleDelete = async () => {
    await wa.deleteMedia.execute(lastMediaId || downloadId);
    setLastMediaId("");
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-[var(--color-text)] font-medium text-sm flex items-center space-x-2">
        <Upload size={16} />
        <span>Upload Media</span>
      </h3>
      <div className="space-y-2">
        <input
          value={uploadPath}
          onChange={(e) => setUploadPath(e.target.value)}
          className="sor-input w-full"
          placeholder="File path"
        />
        <input
          value={uploadMime}
          onChange={(e) => setUploadMime(e.target.value)}
          className="sor-input w-full"
          placeholder="MIME type (e.g. image/jpeg)"
        />
        <button
          onClick={handleUpload}
          disabled={wa.uploadMediaFile.loading || !uploadPath || !uploadMime}
          className="sor-btn-primary flex items-center space-x-2"
        >
          {wa.uploadMediaFile.loading ? <LoadingSpinner /> : <Upload size={14} />}
          <span>Upload</span>
        </button>
        <ErrorMsg msg={wa.uploadMediaFile.error} />
        {lastMediaId && (
          <div className="text-green-400 text-xs">Media ID: {lastMediaId}</div>
        )}
      </div>

      <hr className="border-[var(--color-border)]" />

      <h3 className="text-[var(--color-text)] font-medium text-sm flex items-center space-x-2">
        <Download size={16} />
        <span>Download / Inspect Media</span>
      </h3>
      <div className="space-y-2">
        <input
          value={downloadId}
          onChange={(e) => setDownloadId(e.target.value)}
          className="sor-input w-full"
          placeholder="Media ID"
        />
        <div className="flex space-x-2">
          <button onClick={handleGetUrl} className="sor-btn flex items-center space-x-1">
            {wa.getMediaUrl.loading ? <LoadingSpinner /> : <Link size={14} />}
            <span>Get URL</span>
          </button>
          <button onClick={handleDownload} className="sor-btn flex items-center space-x-1">
            {wa.downloadMedia.loading ? <LoadingSpinner /> : <Download size={14} />}
            <span>Download</span>
          </button>
          <button onClick={handleDelete} className="sor-btn flex items-center space-x-1 text-red-400">
            {wa.deleteMedia.loading ? <LoadingSpinner /> : <Trash2 size={14} />}
            <span>Delete</span>
          </button>
        </div>
        <ErrorMsg msg={wa.getMediaUrl.error ?? wa.downloadMedia.error ?? wa.deleteMedia.error} />
        {mediaUrl && (
          <div className="text-xs break-all text-[var(--color-textSecondary)]">
            URL: {mediaUrl}
          </div>
        )}
        {downloaded && (
          <div className="text-xs text-[var(--color-textSecondary)]">
            Downloaded {downloaded.mime} — {Math.round(downloaded.data.length * 0.75 / 1024)} KB
          </div>
        )}
      </div>
    </div>
  );
};

export default MediaTab;
