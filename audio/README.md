# 錄音檔資料夾

想讓跟讀小鸚鵡的範例發音更自然（不是機器人語音），把錄好的音檔放這裡就好，不用改任何程式碼。

## 規則

- 檔名就是要唸的文字，副檔名 `.mp3`
- 單字模式：`你.mp3`、`好.mp3`、`媽.mp3` ……（跟 `games/zhuyin-speak/index.html` 裡 `WORDS` 陣列的 `hanzi` 一致）
- 短句模式：`你好.mp3`、`大家好.mp3` ……（跟 `SENTENCES` 陣列裡每個字的 `hanzi` 接起來一致）

遊戲會先試著播放這裡的錄音檔，找不到（或播放失敗）才會退回瀏覽器語音合成——所以就算一個字都還沒錄，遊戲也照常能玩。

## 怎麼錄

手機錄音 App 錄一句、轉成 mp3（或直接錄 m4a 用線上工具轉檔）、丟進這個資料夾、檔名改成對應的字就完成了。跟小孩一起錄也是個有趣的活動——可以讓他自己選「爸爸唸的」還是「媽媽唸的」比較好聽！

---

## 英文錄音檔（audio/en/）

一年級學英文，聽到的聲音最好跟學校一致。機器語音唸單字有時會怪（尤其單獨一個字母、insect 這類字），最好的辦法是**家人自己錄**——大人、小孩、輪流都好。

### 規則

- 放在 `audio/en/` 資料夾，副檔名 `.mp3`，檔名照下面的表（全小寫、用 - 連接）
- 不用改任何程式碼；遊戲會先找錄音檔，找不到才退回語音合成，所以錄多少都行，可以慢慢補
- 先錄 `cat.mp3` 就好——遊戲開啟時會偵測它，偵測到才會優先用錄音檔
- 發音請照學校教的（美式或英式都行，只要跟學校一樣）
- 每個大約 1～2 秒，單獨唸、前後留一點點空白就好

### 要錄的清單（共 47 個）

**字母名稱**（唸字母本身，例如 "bee"，不是它的音 "buh"）

| 檔名 | 唸 |
|---|---|
| `letter-a.mp3` | A |
| `letter-b.mp3` | B |
| `letter-c.mp3` | C |
| `letter-d.mp3` | D |
| `letter-e.mp3` | E |
| `letter-f.mp3` | F |
| `letter-g.mp3` | G |
| `letter-h.mp3` | H |
| `letter-i.mp3` | I |
| `letter-j.mp3` | J |
| `letter-k.mp3` | K |
| `letter-l.mp3` | L |
| `letter-m.mp3` | M |

**單字**

| 檔名 | 唸 | 中文 |
|---|---|---|
| `ant.mp3` | ant | 螞蟻 |
| `bird.mp3` | bird | 鳥 |
| `cat.mp3` | cat | 貓 |
| `dog.mp3` | dog | 狗 |
| `egg.mp3` | egg | 蛋 |
| `fish.mp3` | fish | 魚 |
| `girl.mp3` | girl | 女孩 |
| `hat.mp3` | hat | 帽子 |
| `insect.mp3` | insect | 昆蟲 |
| `jet.mp3` | jet | 噴射機 |
| `kite.mp3` | kite | 風箏 |
| `lion.mp3` | lion | 獅子 |
| `monkey.mp3` | monkey | 猴子 |

**數字**

| 檔名 | 唸 |
|---|---|
| `one.mp3` | one |
| `two.mp3` | two |
| `three.mp3` | three |
| `four.mp3` | four |
| `five.mp3` | five |
| `six.mp3` | six |
| `seven.mp3` | seven |
| `eight.mp3` | eight |
| `nine.mp3` | nine |
| `ten.mp3` | ten |

**生活對話**

| 檔名 | 唸 | 中文 |
|---|---|---|
| `good-morning.mp3` | Good morning. | 早安。 |
| `hi.mp3` | Hi! | 嗨！ |
| `hello.mp3` | Hello! | 哈囉！ |
| `line-up-please.mp3` | Line up, please. | 請排隊。 |
| `look.mp3` | Look! | 看！ |
| `are-you-ready.mp3` | Are you ready? | 準備好了嗎？ |
| `yes.mp3` | Yes. | 好了。 |
| `watch-out.mp3` | Watch out! | 小心！ |
| `goodbye.mp3` | Goodbye. | 再見。 |
| `bye.mp3` | Bye. | 再見。 |
| `see-you.mp3` | See you. | 再見。 |

學校教到 N～Z 之後，在 `shared/english-exam.js` 加了新字，照同樣的規則多錄就好。
