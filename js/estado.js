// estado.js — data de referencia e os tres navegadores de mes (Contas, Retirada, Painel).
// mesAtual/mesRet/mesPainel sao objetos mutados in-place (nunca reatribuidos) para funcionarem
// como estado compartilhado vivo entre modulos ES.

export const hoje=new Date();
export const DIA_HOJE=hoje.getDate();

export const mesAtual={y:hoje.getFullYear(),m:hoje.getMonth()};
export const mesRet={y:hoje.getFullYear(),m:hoje.getMonth()};
export const mesPainel={y:hoje.getFullYear(),m:hoje.getMonth()};
