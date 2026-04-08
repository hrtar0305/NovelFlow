import { useRef, useEffect } from 'react';
import { liteClient } from 'algoliasearch/lite';
import { InstantSearch, SearchBox, Hits, useInstantSearch, useSearchBox } from 'react-instantsearch';
import { Link } from 'react-router-dom';
import type { Hit, SearchClient } from 'instantsearch.js';
import { debounce } from 'instantsearch.js/es/lib/utils';
import './Search.css';

const appId = import.meta.env.VITE_ALGOLIA_APP_ID || 'YOUR_APP_ID';
const apiKey = import.meta.env.VITE_ALGOLIA_SEARCH_API_KEY || 'YOUR_SEARCH_ONLY_API_KEY';

const originalSearchClient = liteClient(appId, apiKey) as SearchClient;

// 500ms 디바운스 — 빠른 타이핑 중 불필요한 요청 차단
const debouncedSearch = debounce(
  originalSearchClient.search.bind(originalSearchClient),
  500
) as SearchClient['search'];

// 빈 쿼리(초기 마운트 등)는 API 요청 자체를 건너뜀
const searchClient: SearchClient = {
  ...originalSearchClient,
  search(requests) {
    if (requests.every(({ params }) => !params?.query)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Promise.resolve({ results: requests.map(() => ({ hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 0, processingTimeMS: 0, exhaustiveNbHits: true, query: '', params: '' })) }) as any;
    }
    return debouncedSearch(requests);
  },
};

function HitComponent({ hit }: { hit: Hit }) {
  const { clear } = useSearchBox();
  const url = hit.type === 'novel' ? `/novels/${hit.id}` : `/authors/${hit.id}`;
  const typeDisplay = hit.type === 'novel' ? '소설' : '작가';

  return (
    <Link to={url} className="aa-ItemLink" onClick={clear}>
      <div className="aa-ItemContent">
        <div className="aa-ItemTitle">{hit.name}</div>
        <div className="aa-ItemContentDescription">{typeDisplay}</div>
      </div>
    </Link>
  );
}

function SearchContent() {
  const { uiState, results } = useInstantSearch();
  const { clear } = useSearchBox();
  const query = uiState.novels_and_authors?.query || '';
  const showResults = query.length > 0 && results.query === query;
  const wrapperRef = useRef<HTMLDivElement>(null);

  // 검색창 바깥 클릭 시 결과창 닫기
  useEffect(() => {
    if (!showResults) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        clear();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showResults, clear]);

  return (
    <div className="search-wrapper" ref={wrapperRef}>
      <SearchBox placeholder="검색" className="search-box" />
      {showResults && (
        <div className="search-results">
          {results.nbHits === 0 ? (
            <div className="search-no-results">검색 결과가 없습니다.</div>
          ) : (
            <Hits hitComponent={HitComponent} />
          )}
        </div>
      )}
    </div>
  );
}

export function Search() {
  if (!appId || appId === 'YOUR_APP_ID') {
    return (
      <div className="search-placeholder">검색 기능이 설정되지 않았습니다. Algolia 인증 정보를 추가해주세요.</div>
    );
  }

  return (
    <InstantSearch
      searchClient={searchClient}
      indexName="novels_and_authors"
      future={{ preserveSharedStateOnUnmount: true }}
    >
      <SearchContent />
    </InstantSearch>
  );
}
