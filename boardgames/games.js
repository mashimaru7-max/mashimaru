/* Add games here. Each game owns its route and logic; the hub renders this catalog. */
window.BOARD_GAMES = Object.freeze([
  {id:'blitz',title:'블리츠',subtitle:'번쩍! 단어 대결',description:'같은 기호를 발견했다면? 상대 카드에 맞는 단어를 먼저 외쳐봐!',href:'../blitz/',players:[2,3,4],tags:['순발력','단어'],status:'available',art:'blitz',label:'지금 플레이'},
  {id:'what-the-bug',title:'왓더벅',subtitle:'눈송이의 몸짓 극장',description:'특징 하나, 벌레 하나. 엉뚱한 조합을 몸짓으로 표현하고 맞혀봐!',href:'../what-the-bug/',players:[2,3,4,5,6],tags:['몸짓','파티','협력'],status:'available',art:'bug-theater',label:'무대에 입장'}
]);
