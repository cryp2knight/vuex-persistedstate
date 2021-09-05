import { Store, MutationPayload } from "vuex";
import merge from "deepmerge";
import * as shvl from "shvl";

interface Storage {
  getItem: (key: string) => any;
  setItem: (key: string, value: any) => void;
  removeItem: (key: string) => void;
}

interface PathOptions {
  path: string;
  storage: Storage;
}
interface Options<State> {
  key?: string;
  paths?: (string | PathOptions)[];
  reducer?: (state: State, paths: string[]) => object;
  subscriber?: (
    store: Store<State>
    ) => (handler: (mutation: any, state: State) => void) => void;
  storage?: Storage;
  getState?: (key: string, storage: Storage) => any;
  setState?: (key: string, state: any, storage: Storage) => void;
  filter?: (mutation: MutationPayload) => boolean;
  arrayMerger?: (state: any[], saved: any[]) => any;
  rehydrated?: (store: Store<State>) => void;
  fetchBeforeUse?: boolean;
  overwrite?: boolean;
  assertStorage?: (storage: Storage) => void | Error;
}

export default function <State>(
  options?: Options<State>
): (store: Store<State>) => void {
  options = options || {};

  const storage = options.storage || (window && window.localStorage);
  const key = options.key || "vuex";

  function getState(key, storage) {
    const value = storage.getItem(key);

    try {
      return (typeof value !== "undefined")
        ? JSON.parse(value)
        : undefined;
    } catch (err) {}

    return undefined;
  }

  function filter() {
    return true;
  }

  function setState(key, state, storage) {
    return storage.setItem(key, JSON.stringify(state));
  }

  function reducer(state, paths) {
    const pathBuilder = (path) => {
      if (typeof path === "string" || !path) {
        return path;
      }
      return path.path;
    };
    return Array.isArray(paths)
      ? paths.reduce(function (substate, path) {
          path = pathBuilder(path);
          return shvl.set(substate, path, shvl.get(state, path));
        }, {})
      : state;
  }

  function getPathsGroup(paths) {
    if (!paths) {
      return paths;
    }
    const grouped = { strings: { paths: [], storage: undefined } };
    const objs = [];

    function getOrSetObjectKey(obj) {
      const objIndex = objs.findIndex((o) => Object.is(obj, o));
      if (objIndex > -1) {
        return objIndex;
      }
      objs.push(obj);
      return objs.length - 1;
    }

    for (const path of paths) {
      if (typeof path === "string") {
        grouped.strings.paths.push(path);
      } else {
        const index = getOrSetObjectKey(path.storage);
        (grouped[index] = grouped[index] || {
          storage: path.storage,
          paths: [],
        }).paths.push(path);
      }
    }
    return Object.values(grouped);
  }

  function subscriber(store) {
    return function (handler) {
      return store.subscribe(handler);
    };
  }

  const assertStorage =
    options.assertStorage ||
    (() => {
      storage.setItem("@@", 1);
      storage.removeItem("@@");
    });

  assertStorage(storage);

  const fetchSavedState = () => {
    const paths = getPathsGroup(options.paths);
    if (!paths) {
      return (options.getState || getState)(key, storage);
    }
    return paths.reduce(
      function (prev, cur) {
        const state =
          ((options.getState || getState)(key, cur.storage || storage) || {})[
            key
          ] || {};
        prev[key] = { ...prev[key], ...state };
        return prev;
      },
      { [key]: {} }
    );
  };

  let savedState;

  if (options.fetchBeforeUse) {
    savedState = fetchSavedState();
  }

  return function (store: Store<State>) {
    if (!options.fetchBeforeUse) {
      savedState = fetchSavedState();
    }

    if (typeof savedState === "object" && savedState !== null) {
      store.replaceState(
        options.overwrite
          ? savedState
          : merge(store.state, savedState, {
              arrayMerge:
                options.arrayMerger ||
                function (store, saved) {
                  return saved;
                },
              clone: false,
            })
      );
      (options.rehydrated || function () {})(store);
    }

    (options.subscriber || subscriber)(store)(function (mutation, state) {
      if ((options.filter || filter)(mutation)) {
        const paths = getPathsGroup(options.paths);
        if (!paths) {
          (options.setState || setState)(
            key,
            (options.reducer || reducer)(state, options.paths),
            storage
          );
        } else {
          for (const path of paths) {
            (options.setState || setState)(
              key,
              (options.reducer || reducer)(state, path.paths),
              path.storage || storage
            );
          }
        }
      }
    });
  };
}
