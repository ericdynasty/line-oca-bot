// api/_oca_rules.js
// 規則與句庫（JS 版）。你也可以改用 /data/oca_rules.json（submit-oca.js 會優先讀 JSON）。

module.exports = {
  // 等級與臨界值（由高到低）
  bands: [
    { id: 'high_heavy', min: 41, label: '高(重)' },
    { id: 'high_light', min: 11, label: '高(輕)' },
    { id: 'neutral',    min: -10, label: '中性'  },
    { id: 'low_light',  min: -40, label: '低(輕)' },
    { id: 'low_heavy',  min: -100,label: '低(重)' }
  ],

  // A~J 名稱與對應等級的文字（請把教材句庫貼進 text）
  letters: {
    A: {
      name: '穩定',
      text: {
        high_heavy: '（教材 A5）偏高且影響重，驅動力大。',
        high_light: '（教材 A3）略偏高，較能維持狀態。',
        neutral:    '（教材 A1）中性，較平衡。',
        low_light:  '（教材 A2）略偏低，偶爾受影響。',
        low_heavy:  '（教材 A4）不足感明顯，需特別留意。'
      }
    },
    B: {
      name: '價值',
      text: {
        high_heavy: '（教材 B5）價值感強烈，行動動機明確。',
        high_light: '（教材 B3）略偏高，偏向堅持自我。',
        neutral:    '（教材 B1）中性，較平衡。',
        low_light:  '（教材 B2）略偏低，偶有動搖。',
        low_heavy:  '（教材 B4）對自我價值的懷疑較多。'
      }
    },
    C: {
      name: '變化',
      text: {
        high_heavy: '（教材 C5）喜歡改變與挑戰。',
        high_light: '（教材 C3）略偏高，較能接受改變。',
        neutral:    '（教材 C1）中性，較平衡。',
        low_light:  '（教材 C2）略偏低，偏向維持現狀。',
        low_heavy:  '（教材 C4）對變動有明顯排斥。'
      }
    },
    D: {
      name: '果敢',
      text: {
        high_heavy: '（教材 D5）主動果決、行動力強。',
        high_light: '（教材 D3）略偏高，偏向積極表達。',
        neutral:    '（教材 D1）中性，較平衡。',
        low_light:  '（教材 D2）略偏低，表達與行動較保守。',
        low_heavy:  '（教材 D4）不易做決斷，需更多支持。'
      }
    },
    E: {
      name: '活躍',
      text: {
        high_heavy: '（教材 E5）活力強、外向展現明顯。',
        high_light: '（教材 E3）略偏高，偏向外放互動。',
        neutral:    '（教材 E1）中性，較平衡。',
        low_light:  '（教材 E2）略偏低，社交傾向較少。',
        low_heavy:  '（教材 E4）明顯沉靜，需留意活力不足。'
      }
    },
    F: {
      name: '樂觀',
      text: {
        high_heavy: '（教材 F5）積極正向，信心高。',
        high_light: '（教材 F3）略偏高，較能看到機會。',
        neutral:    '（教材 F1）中性，較平衡。',
        low_light:  '（教材 F2）略偏低，偶有負向解讀。',
        low_heavy:  '（教材 F4）悲觀看法較多，需留意。'
      }
    },
    G: {
      name: '責任',
      text: {
        high_heavy: '（教材 G5）責任感強，遵循規範。',
        high_light: '（教材 G3）略偏高，偏向守秩序。',
        neutral:    '（教材 G1）中性，較平衡。',
        low_light:  '（教材 G2）略偏低，彈性較大。',
        low_heavy:  '（教材 G4）對規範抗拒明顯。'
      }
    },
    H: {
      name: '評估力',
      text: {
        high_heavy: '（教材 H5）分析評估清楚，決策有效。',
        high_light: '（教材 H3）略偏高，偏向理性衡量。',
        neutral:    '（教材 H1）中性，較平衡。',
        low_light:  '（教材 H2）略偏低，判斷偶受情緒影響。',
        low_heavy:  '（教材 H4）評估與判斷較為困難。'
      }
    },
    I: {
      name: '欣賞能力',
      text: {
        high_heavy: '（教材 I5）欣賞他人與自我，動能大。',
        high_light: '（教材 I3）略偏高，偏向肯定正向。',
        neutral:    '（教材 I1）中性，較平衡。',
        low_light:  '（教材 I2）略偏低，肯定感較少。',
        low_heavy:  '（教材 I4）不易欣賞自我或他人。'
      }
    },
    J: {
      name: '滿意能力',
      text: {
        high_heavy: '（教材 J5）滿意度高，容易正向累積。',
        high_light: '（教材 J3）略偏高，較能感受滿足。',
        neutral:    '（教材 J1）中性，較平衡。',
        low_light:  '（教材 J2）略偏低，滿足感較少。',
        low_heavy:  '（教材 J4）容易不滿，需另尋資源。'
      }
    }
  },

  // （可選）若要做更口語化的人物側寫，可以在這裡放模板
  persona: {
    templates: [
      // 之後你可依教材寫出更完整、多種分支的模板
      '整體呈現：{L1Name}{dir1}、{L2Name}{dir2}；傾向「{tone1}、{tone2}」（示意）。'
    ]
  }
};
