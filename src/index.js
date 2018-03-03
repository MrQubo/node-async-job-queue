'use strict'

const EventEmitter = require('events')
const {inspect} = require('util')

/**
 * @public
 * @extends EventEmitter
 */
class PromisePool extends EventEmitter {
  /**
   * @public
   * @param  {Iterable<Promise<*, *>>} source Promises generator
   * @param  {number} concurrency Max number of active Promises at one time
   * @param  {Object} [options]
   * @param  {?number} [options.timeout=null]
   * @param  {function(*): *} [options.onResolve=() => null] Called non-asynchonously after resolve. If this function returns Error, {@link PromisePool#promise promise} will be rejected. If this function returns non-null, {@link PromisePool#promise promise} will be resolved.
   * @param  {function(*): *} [options.onReject=err => err] Called non-asynchonously after reject. If this function returns non-null, {@link PromisePool#promise promise} will be rejected.
   */
  constructor(source, concurrency, {timeout = null, onResolve, onReject} = {}) {
    super()

    /**
     * See {@link PromisePool#source source}
     * @protected
     * @type {Iterable<Promise<*, *>>}
     */
    this._source = source[Symbol.iterator]()
    /**
     * See {@link PromisePool#concurrency concurrency}
     * @protected
     * @type {number}
     */
    this._concurrency = concurrency
    /**
     * See {@link PromisePool#timeout timeout}
     * @protected
     * @type {?number}
     */
    this._timeout = !timeout || timeout <= 0  ?  null  :  timeout

    /**
     * See {@link PromisePool#active active}
     * @private
     * @type {number}
     */
    this._active = 0
    /**
     * See {@link PromisePool#spawned spawned}
     * @private
     * @type {number}
     */
    this._spawned = 0

    /**
     * See {@link PromisePool#promise promise}
     * @private
     * @type {Promise<*, *>}
     */
    this._promise = null
    /**
     * {@link PromisePool#promise promise} resolve callback
     * @private
     * @type {function(?*)}
     */
    this._resolve = null
    /**
     * {@link PromisePool#promise promise} reject callback
     * @private
     * @type {function(*)}
     */
    this._reject = null

    /**
     * See {@link PromisePool#promise_no_active promise_no_active}
     * @private
     * @type {Promise<undefined>}
     */
    this._promise_no_active = null
    /**
     * {@link PromisePool#promise_no_active promise_no_active} resolve callback
     * @private
     * @type {function()}
     */
    this._resolve_no_active = null

    /**
     * See {@link PromisePool#onResolve onResolve}
     * @protected
     * @type {function(?*): *}
     */
    this._resolveCallback = onResolve || (() => null)
    /**
     * See {@link PromisePool#onReject onReject}
     * @protected
     * @type {function(*): *}
     */
    this._rejectCallback = onReject || (err => err)

    /**
     * See {@link PromisePool#spawned_all spawned_all}
     * @private
     * @type {boolean}
     */
    this._spawned_all = false
    /**
     * See {@link PromisePool#canceled canceled}
     * @private
     * @type {boolean}
     */
    this._canceled = false
    /**
     * See {@link PromisePool#no_active no_active}
     * @private
     * @type {boolean}
     */
    this._no_active = false
    /**
     * See {@link PromisePool#error error}
     * @protected
     * @type {?*}
     */
    this._error = null
  }


  /**
   * Max number of active Promises at one time
   * @public
   * @type {number}
   */
  get concurrency() {
    return this._concurrency
  }

  /**
   * @public
   * @type {?number}
   */
  get timeout() {
    return this._timeout
  }

  /**
   * Resolved after {@link PromisePool#source source} depletion or {@link PromisePool#onResolve onResolve} returns non-Error non-null.
   * Rejected after {@link PromisePool#onResolve onResolve} returns Error or {@link PromisePool#onReject onReject} returns non-null.
   * Created in {@link PromisePool#start start} method.
   * @public
   * @type {Promise<*, Error>}
   */
  get promise() {
    return this._promise
  }

  /**
   * Resolved after all started promises end.
   * Created in {@link PromisePool#start start} method.
   * @public
   * @type {Promise<undefined>}
   */
  get promise_no_active() {
    return this._promise_no_active
  }

  /**
   * True if {@link PromisePool#source source} was depleted, false otherwise
   * @public
   * @type {boolean}
   */
  get spawned_all() {
    return this._spawned_all
  }

  /**
   * True if {@link PromisePool#canceled canceled} promise pool was canceled by {@link PromisePool#cancel cancel}
   * @public
   * @type {boolean}
   */
  get canceled() {
    return this._canceled
  }

  /**
   * True if {@link PromisePool#spawned_all spawned_all}, {@link PromisePool#canceled canceled} meaning no more promises will be spawned
   * @public
   * @type {boolean}
   */
  get ended() {
    return this._ended
  }

  /**
   * See {@link PromisePool#ended ended}
   * @protected
   * @type {boolean}
   */
  get _ended() {
    return this._spawned_all || this._canceled
  }

  /**
   * True if {@link PromisePool#ended ended} is true and there's no longer any active promise
   * @public
   * @type {boolean}
   */
  get no_active() {
    return this._no_active
  }

  /**
   * Number of currently active promises
   * @public
   * @type {number}
   */
  get active() {
    return this._active
  }

  /**
   * Number of spawned promises
   * @public
   * @type {number}
   */
  get spawned() {
    return this._spawned
  }

  /**
   * Set to Error returned by {@link PromisePool#onResolve onResolve} or non-null returned by {@link PromisePool#onReject onReject}
   * @public
   * @type {?*}
   */
  get error() {
    return this._error
  }

  /**
   * Same as {@link PromisePool constructor}'s source parameter Symbol.iterator property
   * @public
   * @type {Iterable<Promise<*, *>>}
   */
  get source() {
    return this._source
  }

  /**
   * Same as {@link PromisePool constructor}'s options.onResolve parameter if non-null, (() => null) otherwise
   * @public
   * @type {function(?*): *}
   */
  get onResolve() {
    return this._resolveCallback
  }
  /**
   * Same as {@link PromisePool constructor}'s options.onReject parameter if non-null, (err => err) otherwise
   * @public
   * @type {function(*): *}
   */
  get onReject() {
    return this._rejectCallback
  }

  /**
   * Start generating and spawning Promises
   * @public
   * @return {Promise<*, Error>} Same as {@link PromisePool#promise promise}
   */
  start() {
    if (this._promise) { return this._promise }

    return this._promise = new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject

      this._promise_no_active = new Promise(resolve_no_active => {
        this._resolve_no_active = resolve_no_active

        while (this._active < this._concurrency) {
          this._spawnNextPromise()
          if (this._ended) { break }
        }

        if (this._spawned === 0) {
          this._resolvePromise()
          this._resolveNoActive()
        }
      })
    })
  }

  /**
   * Cancels all promises and stops generating new one
   * @public
   */
  cancel() {
    this._canceled = true
  }


  /**
   * Generate next Promise and spawn it
   * @protected
   * @return {boolean} Same as {@link PromisePool#_ended _ended}
   */
  _spawnNextPromise() {
    if (this._ended) { return true }

    const next = this._source.next()
    if (next.done) {
      this._spawned_all = true
      return true
    }

    const promise_gen = next.value
    this._spawnPromise(promise_gen)
    return false
  }

  /**
   * @public
   * @typedef {{promise_pool: PromisePool, canceled: function(): boolean, timeouted: function(): boolean}} PromisePool#InfoObject
   */

  /**
   * Spawn promise and bind {@link PromisePool#_onResolve _onResolve} and {@link PromisePool#_onReject _onReject}
   * @protected
   * @param {function(PromisePool#InfoObject): Promise<*, *>} promise_gen Function returning promise to spawn
   */
  _spawnPromise(promise_gen) {
    const self = this
    let _timeouted = false

    const info = {
      promise_pool() { return self },
      canceled() { return _timeouted || self._canceled },
      timeouted() { return _timeouted }
    }

    ++this._active
    ++this._spawned

    const promise = promise_gen(info)

    promise
      .then(this._onResolve.bind(this, info))
      .catch(this._onReject.bind(this, info))

    if (this._timeout) {
      setTimeout(() => {
        _timeouted = true
      }, this._timeout)
    }
  }

  /**
   * Same as argument passed to {@link PromisePool#_resolveCallback _resolveCallback}
   * @event PromisePool#event:resolve
   * @type {*}
   */
  /**
   * Resolve callback for spawned promises
   * @private
   * @fires PromisePool#event:resolve
   * @param {PromisePool#InfoObject} info
   * @param {*} res Passed to {@link PromisePool#_resolveCallback _resolveCallback}
   */
  _onResolve(info, res) {
    this.emit('resolve', res)

    this._handlePromiseResult(
      () => this._resolveCallback(res),
      cb_res => cb_res instanceof Error
    )
  }

  /**
   * Same as argument passed to {@link PromisePool#_rejectCallback _rejectCallback}
   * @event PromisePool#event:reject
   * @type {*}
   */
  /**
   * Reject callback for spawned promises
   * @private
   * @fires PromisePool#event:reject
   * @param {PromisePool#InfoObject} info
   * @param {*} err Passed to {@link PromisePool#_rejectCallback _rejectCallback}
   */
  _onReject(info, err) {
    this.emit('reject', err)

    this._handlePromiseResult(
      () => this._rejectCallback(err),
      cb_res => cb_res
    )
  }

  /**
   * Helper function for {@link PromisePool#_onResolve _onResolve} and {@link PromisePool#_onReject _onReject}
   * @private
   * @param {function(): *} cb Function returning result
   * @param {function(?*): boolean} isError Determinate if result is an error
   */
  _handlePromiseResult(cb, isError) {
    --this._active

    const cb_res = cb()

    if (this._ended) {
      if (this._active === 0) { this._resolveNoActive() }
      return
    }

    if (isError(cb_res)) {

      this._rejectPromise(cb_res)
      if (this._active === 0) { this._resolveNoActive() }

    } else if (cb_res) {

      this._resolvePromise(cb_res)
      if (this._active === 0) { this._resolveNoActive() }

    } else {

      this._spawnNextPromise()

    }
  }

  /**
   * Resolve {@link PromisePool#no_active_promise no_active_promise}
   * @private
   */
  _resolveNoActive() {
    this._no_active = true
    this._resolve_no_active()
    this._resolve_no_active = () => {}
  }

  /**
   * Resolve {@link PromisePool#promise promise}
   * @protected
   * @param {*} res Passed as resolve result to {@link PromisePool#promise promise}
   */
  _resolvePromise(res) {
    this._resolve(res)
    this._endPromise()
  }

  /**
   * Reject {@link PromisePool#promise promise}
   * @protected
   * @param {*} err Passed as rejection error to {@link PromisePool#promise promise}
   */
  _rejectPromise(err) {
    this._error = err

    this._reject(err)
    this._endPromise()
  }

  /**
   * Helper function for {@link PromisePool#_resolvePromise _resolvePromise} and {@link PromisePool#_rejectPromise _rejectPromise}
   * @protected
   */
  _endPromise() {
    this.cancel()
    this._resolve = () => {}
    this._reject = () => {}
  }
}


/**
 * @public
 * @module promise-pool
 * @type {PromisePool}
 */
module.exports = PromisePool
