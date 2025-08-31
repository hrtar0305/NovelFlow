import { liteClient } from 'algoliasearch/lite';
import { InstantSearch, SearchBox, Hits, useInstantSearch, useSearchBox } from 'react-instantsearch'; // useSearchBox 추가
import { Link } from 'react-router-dom';
import type { Hit, SearchClient } from 'instantsearch.js'; // SearchClient 추가
import { debounce } from 'instantsearch.js/es/lib/utils';
import './Search.css';

// IMPORTANT: Replace with your own Algolia credentials
// You can find these in your Algolia dashboard: https://www.algolia.com/dashboard/
const appId = import.meta.env.VITE_ALGOLIA_APP_ID || 'YOUR_APP_ID';

// Use the *Search-Only* API Key for frontend queries for security.
const apiKey = import.meta.env.VITE_ALGOLIA_SEARCH_API_KEY || 'YOUR_SEARCH_ONLY_API_KEY';

const originalSearchClient = liteClient(appId, apiKey) as SearchClient;

const debouncedSearchClient: SearchClient = {
  ...originalSearchClient,
  search: debounce(originalSearchClient.search, 300) as SearchClient['search'],
};

// Custom component to render a single search result
function HitComponent({ hit }: { hit: Hit }) {
  const { clear } = useSearchBox(); // clear 함수 가져오기
  const url = hit.type === 'novel' ? `/novels/${hit.id}` : `/authors/${hit.id}`;
  const typeDisplay = hit.type === 'novel' ? '소설' : '작가';

  return (
    <Link to={url} className="aa-ItemLink" onClick={clear}> {/* onClick 핸들러 추가 */}
      <div className="aa-ItemContent">
        <div className="aa-ItemTitle">{hit.name}</div>
        <div className="aa-ItemContentDescription">{typeDisplay}</div>
      </div>
    </Link>
  );
}

// This new component will contain the actual search UI
// and use hooks to control rendering.
function SearchContent() {
    const { uiState, results } = useInstantSearch();
    const query = uiState.novels_and_authors?.query || '';

    // Show results only when a query is entered AND the results are for that specific query.
    // This prevents showing stale results from a previous query or an initial empty query.
    const showResults = query.length > 0 && results.query === query;

    return (
        <div className="search-wrapper">
            <SearchBox 
                placeholder="소설, 작가 검색" 
                className="search-box" 
            />
            {showResults && (
                <div className="search-results">
                    <Hits hitComponent={HitComponent} />
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
        searchClient={debouncedSearchClient} 
        indexName="novels_and_authors"
        future={{ preserveSharedStateOnUnmount: true }}
    >
        <SearchContent />
    </InstantSearch>
  );
}
