import {ClubSearch} from './club-search';
export const metadata={title:'Trouver un club · D3 Amateur',description:'Recherchez un club de football amateur dans le registre national D3.'};
export default function ClubsPage(){return <main className="main registry-page"><p className="eyebrow">Registre national</p><h1>Trouvez votre club.</h1><p className="lead">Une recherche tolérante aux accents, sigles et variations d’écriture.</p><ClubSearch/></main>}
