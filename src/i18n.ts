export const dictionaries={tr:{overview:'Genel bakış',accounts:'Hesaplar & MT5',analysis:'AI analizleri',trades:'İşlemler',telegram:'Telegram onayları',risk:'Risk & yetkiler',audit:'Denetim geçmişi',admin:'Kullanıcılar'}};
export type Locale=keyof typeof dictionaries;
export function translate(locale:Locale,key:keyof typeof dictionaries.tr){return dictionaries[locale][key];}

