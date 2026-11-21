# Clustal 彩色序列排版工具

匯入 CLUSTAL 或 MUSCLE 蛋白質比對檔後，可以在瀏覽器調整版面、編輯 TM 標註、儲存專案，以及匯出指定序列和欄位。

## 一鍵預測 TM

上傳 `.aln` 並按下 **一鍵預測 TM 並標註**。網站會將去除 gap 的蛋白質序列以暫時 ID 送去執行 DeepTMHMM。結果回來後會核對完整序列，再把跨膜螺旋和 β 股畫在對應的比對序列下方。請開啟支援此功能的服務網址，或完成下方的 GitHub Pages 設定。

### 一次部署

1. 在 Render 建立 Blueprint，連結此 GitHub 儲存庫。儲存庫的 `render.yaml` 已描述可部署的 Docker 服務。[在 Render 部署](https://render.com/deploy?repo=https://github.com/cherry921120-cloud/first_project)
2. 在 Render 的環境變數中填入有權呼叫 DeepTMHMM 的 `BIOLIB_TOKEN`。部署後，開啟 Render 給你的服務網址，即可使用包含預測按鈕的網站。[BioLib](https://biolib.com/)
3. 若要保留原本的 GitHub Pages 網址，在 `prediction-config.js` 裡將空字串改成預測服務的完整 HTTPS 端點，例如 `https://你的服務.onrender.com/api/predictions`，再提交到 `main`。Blueprint 已設定允許此儲存庫的 Pages 網域。

GitHub Pages 也可透過 **TM 比較 → 從 UniProt 或 DeepTMHMM 帶入 TM** 讀取手動取得的 `predicted_topologies.3line`。同一份結果可選擇檔案或貼上內容。

預測服務預設每次接受 20 條序列、共 20,000 個胺基酸，整站每小時接受 12 次預測。可在主機環境中調整 `PREDICTION_MAX_SEQUENCES`、`PREDICTION_MAX_RESIDUES` 和 `PREDICTION_JOBS_PER_HOUR`。服務以單一 Gunicorn worker 保留工作與結果。

### 用 Docker 啟動

將 `BIOLIB_TOKEN` 放在本機環境變數中，再執行以下指令並開啟 `http://localhost:8000`。

```sh
docker build -t clustal-tm-prediction .
docker run --rm -p 8000:8080 --env BIOLIB_TOKEN clustal-tm-prediction
```
