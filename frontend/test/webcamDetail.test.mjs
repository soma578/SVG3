import assert from 'node:assert/strict'
import test from 'node:test'

import { renderWebcamDetail } from '../../map/layers/portable/japan-river-webcams/webcamDetail.js'

const OFFICIAL = 'https://www.river.go.jp/kawabou/pc/tm?itmkndCd=200&scamId=108449032'

const anchorFor = (html) => {
  const match = /<a class="svg3-property-link"[^>]*>/.exec(html)
  return match ? match[0] : null
}

test('公式URLがあれば、そのURLのリンクを新しいタブ向けに出す', () => {
  const html = renderWebcamDetail({ title: 'テストカメラ', pageUrl: OFFICIAL })
  const anchor = anchorFor(html)
  assert.ok(anchor, '公式ページのリンクが無い')
  assert.match(anchor, /href="https:\/\/www\.river\.go\.jp\/kawabou\/pc\/tm\?/)
  assert.match(anchor, /target="_blank"/)
  assert.match(anchor, /rel="noopener noreferrer"/)
})

test('公式URLが無いときはリンクを出さず、取得できない旨を出す', () => {
  // href="" は「現在のページを開き直す」。利用者には公式ページへ飛べない理由が
  // 伝わらないまま地図が再読み込みされたように見える。
  for (const feature of [
    { title: 'URLなし' },
    { title: '空文字', pageUrl: '' },
    { title: 'null', pageUrl: null },
  ]) {
    const html = renderWebcamDetail(feature)
    assert.equal(anchorFor(html), null, `${feature.title}: 空リンクが出ている`)
    assert.match(html, /公式URLを取得できません/)
    assert.doesNotMatch(html, /href=""/)
  }
})

test('公式サイト以外のURLはリンクにしない', () => {
  // 台帳が壊れたり差し替えられたときに、利用者を任意の場所へ飛ばさない。
  for (const url of [
    'http://www.river.go.jp/kawabou',       // https でない
    'https://example.com/kawabou',           // 別ホスト
    'javascript:alert(1)',                   // スキーム悪用
    'https://www.river.go.jp.evil.test/x',   // ホスト名の偽装
  ]) {
    const html = renderWebcamDetail({ title: '不正URL', pageUrl: url })
    assert.equal(anchorFor(html), null, `${url} がリンクになっている`)
    assert.match(html, /公式URLを取得できません/)
  }
})

test('カメラ画像も公式配信元のURLだけを使う', () => {
  const allowed = renderWebcamDetail(
    { title: 'あり', imageUrl: 'https://cam.river.go.jp/x.jpg' },
    { imageEnabled: true },
  )
  assert.match(allowed, /data-source="https:\/\/cam\.river\.go\.jp\/x\.jpg"/)
  assert.match(allowed, /<img[^>]+[\s\S]*src="https:\/\/cam\.river\.go\.jp\/x\.jpg"/)
  const disabled = renderWebcamDetail({ title: '停止', imageUrl: 'https://cam.river.go.jp/x.jpg' })
  assert.doesNotMatch(disabled, /<img[^>]+src=/, 'feature flag確認前に画像を取得している')
  const denied = renderWebcamDetail(
    { title: 'なし', imageUrl: 'https://example.com/x.jpg' },
    { imageEnabled: true },
  )
  assert.doesNotMatch(denied, /example\.com/)
})

test('暫定表示の出典・取得条件・撮影時刻不明を明示する', () => {
  const html = renderWebcamDetail({
    title: '注意表示', imageUrl: 'https://cam.river.go.jp/x.jpg', pageUrl: OFFICIAL,
  }, { imageEnabled: true })
  assert.match(html, /国土交通省「川の防災情報」/)
  assert.match(html, /第三者配信元から利用者操作時に直接取得します/)
  assert.match(html, /撮影時刻：確認できません/)
  assert.match(html, /data-slawa-cooldown-ms="30000"/)
  assert.match(html, /公式ページ/)
})
