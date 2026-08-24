import Capacitor

final class FitnessBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(RestTimerPlugin())
    }
}
